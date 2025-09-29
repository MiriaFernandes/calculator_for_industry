from flask import Flask, render_template, request, redirect, url_for, flash,jsonify
import xml.etree.ElementTree as ET
import firebase_admin
from firebase_admin import credentials, firestore
import os
from datetime import datetime
from werkzeug.utils import secure_filename  # <- IMPORT NECESSÁRIO
from google.cloud.firestore_v1 import FieldFilter  # opcional, não usamos embaixo-
from dotenv import load_dotenv  # <- NOVO IMPORT
from decimal import Decimal
import re
from pdf_processor import extrair_dados_pdf  # <- NOVO IMPORT
import random
import string
# Carrega variáveis do .envcd
load_dotenv()
app = Flask(__name__)
app.secret_key = "chave-super-secreta-123"

# Configuração do Firebase
# cred = credentials.Certificate("projetojuru-firebase-adminsdk-fbsvc-ddc621e377.json")
# firebase_admin.initialize_app(cred)
# db = firestore.client()

# Configuração segura do Firebase
cred_path = os.getenv("FIREBASE_CREDENTIALS")
if not cred_path or not os.path.exists(cred_path):
    raise FileNotFoundError("Arquivo de credenciais do Firebase não encontrado.")

cred = credentials.Certificate(cred_path)
firebase_admin.initialize_app(cred)
db = firestore.client()

# Coloque perto do topo
NS = {'nfe': 'http://www.portalfiscal.inf.br/nfe'}

def _json_safe(x):
    if isinstance(x, datetime):
        return x.isoformat()
    if isinstance(x, list):
        return [_json_safe(v) for v in x]
    if isinstance(x, dict):
        return {k: _json_safe(v) for k, v in x.items()}
    return x

def _find_nfe_root(root):
    """Docstring removida para otimização"""
    # 1) Caso a raiz já seja NFe
    if root.tag.endswith('}NFe') or root.tag == 'NFe':
        return root

    # 2) Procura em qualquer lugar do XML (independente do namespace)
    nfe = root.find('.//{*}NFe')
    if nfe is not None:
        return nfe

    # 3) Alguns fornecedores usam caixa diferente ou prefixos esquisitos
    #    Tenta achar por prefixo localName via varredura
    for elem in root.iter():
        if elem.tag.split('}')[-1] == 'NFe':
            return elem

    return None
def _find_text_anywhere(element, local_name):
    """Busca texto de uma tag ignorando namespaces."""
    if element is None:
        return ''
    # Busca direta usando o namespace conhecido
    found = element.find(f'nfe:{local_name}', NS)
    if found is not None and found.text:
        return found.text
    # Fallback: percorre todas as tags procurando pelo localName
    for elem in element.iter():
        if elem.tag.split('}')[-1] == local_name and elem.text:
            return elem.text
    return ''

def gerar_codigo_numerico():
    """
    Gera um código numérico randômico de 6 dígitos
    Exemplo: 123456, 789012, etc.
    """
    return ''.join(random.choices(string.digits, k=6))

def gerar_codigo_unico(existing_codes):
    """
    Gera um código único numérico que não existe na base
    """
    max_tentativas = 100  # Evita loop infinito
    for _ in range(max_tentativas):
        codigo = gerar_codigo_numerico()
        if codigo not in existing_codes:
            return codigo
    # Se não conseguir em 100 tentativas, usa timestamp
    return f"{int(datetime.now().timestamp()) % 1000000:06d}"

def extrair_identificadores_nfe(xml_file):
    """Retorna (cnpj, numero_nota) extraídos do XML."""
    tree = ET.parse(xml_file)
    root = tree.getroot()
    nfe_root = _find_nfe_root(root)
    if nfe_root is None:
        raise ValueError('Arquivo XML não é uma NFe válida (NFe não encontrada)')
    infNFe = nfe_root.find('nfe:infNFe', NS)
    if infNFe is None:
        raise ValueError('Estrutura XML inválida - tag infNFe não encontrada')
    ide = infNFe.find('nfe:ide', NS)
    emit = infNFe.find('nfe:emit', NS)
    numero_nota = _find_text_anywhere(ide, 'nNF').strip()
    cnpj = _find_text_anywhere(emit, 'CNPJ').strip()
    # Normaliza removendo caracteres não numéricos
    cnpj_digits = ''.join(ch for ch in cnpj if ch.isdigit())
    numero_digits = ''.join(ch for ch in numero_nota if ch.isdigit()) or numero_nota
    if not cnpj_digits or not numero_digits:
        raise ValueError('Não foi possível identificar CNPJ ou número da nota fiscal no XML enviado.')
    return cnpj_digits, numero_digits

def process_xml_file(temp_path, original_filename, *, db_client=None, logger=None):
    """Processa um XML de NF-e verificando duplicidade e retornando dados estruturados."""
    db_client = db_client or db
    try:
        cnpj, numero_nota = extrair_identificadores_nfe(temp_path)
    except ValueError as exc:
        return 400, {'error': str(exc)}
    doc_id = f"{cnpj}-{numero_nota}"
    notas_collection = db_client.collection('notas_fiscais')
    doc_ref = notas_collection.document(doc_id)
    existing = doc_ref.get()
    if hasattr(existing, 'exists') and existing.exists:
        return 409, {'error': 'Nota fiscal já cadastrada para este CNPJ e número.'}
    dados = extrair_dados_xml(temp_path)
    if isinstance(dados, dict) and dados.get('error'):
        return 400, dados
    if logger is not None:
        try:
            logger.info('Registrando nota fiscal %s - %s', cnpj, numero_nota)
        except Exception:
            pass
    doc_ref.set({
        'cnpj': cnpj,
        'numero_nota': numero_nota,
        'arquivo_original': original_filename,
        'criado_em': firestore.SERVER_TIMESTAMP
    })
    return 200, {'itens': dados, 'nota': {'cnpj': cnpj, 'numero': numero_nota}}


def extrair_dados_xml(xml_file):
    try:
        tree = ET.parse(xml_file)
        root = tree.getroot()

        nfe_root = _find_nfe_root(root)
        if nfe_root is None:
            return {'error': 'Arquivo XML não é uma NFe válida (NFe não encontrada)'}

        infNFe = nfe_root.find('nfe:infNFe', NS)
        emit = infNFe.find('nfe:emit', NS)
        nome_fornecedor = ''
        if infNFe is None:
            return {'error': 'Estrutura XML inválida - tag infNFe não encontrada'}
        if emit is not None:
            nome_fornecedor = emit.findtext('nfe:xNome', default='', namespaces=NS)

        # NOVO: pegar a data de emissão no cabeçalho da NF
        ide = infNFe.find('nfe:ide', NS)
        data_emissao = ''
        if ide is not None:
            data_emissao = (
                ide.findtext('nfe:dhEmi', default='', namespaces=NS)
                or ide.findtext('nfe:dEmi', default='', namespaces=NS)  # fallback p/ layouts mais antigos
            )

        # Buscar códigos existentes na base ANTES de processar os itens
        existing_codes = set()
        try:
            docs = db.collection('itens').select(['codigo']).stream()
            for doc in docs:
                data = doc.to_dict()
                if data.get('codigo'):
                    existing_codes.add(str(data['codigo']))
        except Exception as e:
            print(f"AVISO: Não foi possível buscar códigos existentes: {e}")

        lista_dados = []
        for det in infNFe.findall('nfe:det', NS):
            prod = det.find('nfe:prod', NS)
            if prod is None:
                continue

            # NOVO: código interno do item (cProd) — opcional
            cprod = prod.findtext('nfe:cProd', default='', namespaces=NS)

            nome = prod.findtext('nfe:xProd', default='Sem nome', namespaces=NS)
            unidade = prod.findtext('nfe:uCom', default='UN', namespaces=NS)
            valor_text = prod.findtext('nfe:vUnCom', default='0', namespaces=NS)
            quantidade = prod.findtext('nfe:qCom', default='UN', namespaces=NS)

            try:
                valor_unitario = float(valor_text.replace(',', '.'))
            except ValueError:
                valor_unitario = 0.0

            # LÓGICA DE CÓDIGO NUMÉRICO RANDÔMICO
            codigo_final = cprod
            # Se não tem código no XML ou está vazio, gera um numérico único
            if not codigo_final or codigo_final.strip() == '':
                codigo_final = gerar_codigo_unico(existing_codes)
                existing_codes.add(codigo_final)  # Adiciona para evitar duplicatas na mesma importação
            # Se tem código mas é muito curto (menos de 4 dígitos), também gera um novo
            elif len(str(codigo_final).strip()) < 4:
                codigo_final = gerar_codigo_unico(existing_codes)
                existing_codes.add(codigo_final)

            lista_dados.append({
                'codigo': codigo_final,              # Agora sempre tem código
                'nome': nome,
                'unidade': unidade,
                'quantidade': quantidade,
                'valor_unitario': valor_unitario,
                'data_emissao': data_emissao or None,
                'fornecedor': nome_fornecedor or None,
                'timestamp': datetime.now().isoformat()
            })
        return lista_dados

    except ET.ParseError as e:
        return {'error': f'Erro ao analisar XML: {str(e)}'}
    except Exception as e:
        return {'error': str(e)}

@app.route('/listar-itens', methods=['GET'])
def listar_itens():
    try:
        q = (request.args.get('q') or '').strip()
        limit = int(request.args.get('limit', 20))
        cursor_id = request.args.get('cursor')

        col = db.collection('itens')

        # BUSCA GLOBAL (ignora paginação)
        # if q:
        #     qnorm = q.casefold()
        #     docs = list(col.order_by('data_criacao', direction=firestore.Query.DESCENDING).limit(1000).stream())
        #     items = []
        #     for d in docs:
        #         data = d.to_dict() or {}
        #         nome = (data.get('nome') or '').casefold()
        #         codigo = str(data.get('codigo') or '').casefold()
        #         if qnorm in nome or qnorm in codigo:
        #             data['id'] = d.id
        #             items.append(data)
        #         if len(items) >= limit:
        #             break
        #     return jsonify({'items': items, 'next_cursor': None}), 200
        def extrair_preco(data):
            try:
                return Decimal(str(data.get('preco') or '0'))
            except:
                return Decimal('0')
        def extrair_data(data):
            try:
                return str(data.get('data_criacao') or '')
            except:
                return ''
        def normalizar_nome(nome):
            nome = nome.casefold()  # tudo minúsculo
            nome = nome.replace(',', '.')  # troca vírgula por ponto
            nome = re.sub(r'\s+', ' ', nome)  # remove espaços duplicados
            nome = re.sub(r'(\d+,\d+|\d+\.\d+)(mm)', r'\1 mm', nome)  # garante espaço antes de mm
            nome = nome.strip()
            return nome
        if q:
            qnorm = q.casefold()
            docs = list(col.order_by('data_criacao', direction=firestore.Query.DESCENDING).limit(1000).stream())

            melhores_por_nome = {}

            for d in docs:
                data = d.to_dict() or {}
                nome = (data.get('nome') or '').casefold()
                codigo = str(data.get('codigo') or '').casefold()
                preco = extrair_preco(data)
                data_criacao = extrair_data(data)

                if qnorm in nome or qnorm in codigo:
                    chave = normalizar_nome(nome)
                    atual = melhores_por_nome.get(chave)

                    if not atual:
                        data['id'] = d.id
                        melhores_por_nome[chave] = data
                    else:
                        atual_data = extrair_data(atual)
                        atual_preco = extrair_preco(atual)

                        # Se o novo é mais recente, substitui
                        if data_criacao > atual_data:
                            data['id'] = d.id
                            melhores_por_nome[chave] = data
                        # Se a data é igual, pega o de maior valor
                        elif data_criacao == atual_data and preco > atual_preco:
                            data['id'] = d.id
                            melhores_por_nome[chave] = data

                if len(melhores_por_nome) >= limit:
                    break

            items = list(melhores_por_nome.values())
            print('Itens renderizados na busca:')
            for item in melhores_por_nome.values():
                print(f"- {item.get('nome')} | Código: {item.get('codigo')} | Preço: {item.get('preco')} | Data: {item.get('data_criacao')}")

            return jsonify({'items': items, 'next_cursor': None}), 200
        # PAGINADO
        # query = col.order_by('data_criacao', direction=firestore.Query.DESCENDING).limit(limit + 1)

        # if cursor_id:
        #     snap = col.document(cursor_id).get()
        #     if snap.exists:
        #         query = query.start_after(snap)

        # docs_full = list(query.stream())
        # has_more = len(docs_full) > limit
        # docs = docs_full[:limit]

        # items = []
        # for d in docs:
        #     data = d.to_dict() or {}
        #     data['id'] = d.id
        #     items.append(data)

        # next_cursor = docs[-1].id if (has_more and docs) else None
        # return jsonify({'items': items, 'next_cursor': next_cursor}), 200
        
        # PAGINADO
        query = col.order_by('data_criacao', direction=firestore.Query.DESCENDING).limit(limit + 1)

        if cursor_id:
            snap = col.document(cursor_id).get()
            if snap.exists:
                query = query.start_after(snap)

        docs_full = list(query.stream())

        vistos = set()
        items = []

        for d in docs_full:
            data = d.to_dict() or {}
            codigo = str(data.get('codigo') or '').casefold()

            if codigo in vistos:
                continue
            vistos.add(codigo)

            data['id'] = d.id
            items.append(data)

            if len(items) >= limit:
                break

        next_cursor = docs_full[-1].id if (len(docs_full) > limit and docs_full) else None
        return jsonify({'items': items, 'next_cursor': next_cursor}), 200


    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route("/cadastro", methods=["GET", "POST"])
# app.route("/cadastro", methods=["GET", "POST"])
def cadastro():
    print("🔥 Função /cadastro foi chamada")

    if request.method == "POST":
        try:
            print("[HIT] /cadastro POST")

            codigo       = (request.form.get("codigo") or "").strip()
            nome         = (request.form.get("nome") or "").strip()
            fornecedor   = (request.form.get("fornecedor") or "").strip()
            cnpj         = (request.form.get("cnpj") or "").strip()
            descricao    = (request.form.get("descricao") or "").strip()
            data_compra  = (request.form.get("data_compra") or "").strip()
            unidade_in   = (request.form.get("unidade") or request.form.get("medida") or "").strip()
            quantidade   = request.form.get("quantidade")
            valor_unit   = request.form.get("valor_unitario")
            categoria    = (request.form.get("categoria") or "").strip()

            quantidade  = float(str(quantidade).replace(",", ".").strip()) if quantidade else None
            valor_unit  = float(str(valor_unit).replace(",", ".").strip()) if valor_unit else None
            unidade     = unidade_in if unidade_in else None
            
            # Se não informou código, gera um randômico único
            if not codigo:
                existing_codes = set()
                docs = db.collection('itens').select(['codigo']).stream()
                for doc in docs:
                    data = doc.to_dict()
                    if data.get('codigo'):
                        existing_codes.add(data['codigo'])
                codigo = gerar_codigo_unico(existing_codes)
                
            col_itens = db.collection("itens")
            duplicado = False
            
            try:
                q = (col_itens
                        .where("nome", "==", nome)
                        .where("valor_unitario", "==", valor_unit)
                        .where("data_compra", "==", data_compra)
                        .limit(1)
                    )
                existe = next(q.stream(), None)
                if existe is not None:
                    duplicado = True
            except Exception as e:
                print("[ERRO DUPLICIDADE]", e)

            if duplicado:
                flash("Produto duplicado: já existe um cadastro com mesmo Nome, Valor e Data.", "danger")
                return render_template("cadastro.html")

            doc_ref = db.collection("itens").document()

            item_data = {
                "codigo": codigo,
                "nome": nome,
                "fornecedor": fornecedor,
                "cnpj": cnpj,
                "descricao": descricao,
                "categoria": categoria,

                "data_compra": data_compra,
                "data_emissao": data_compra,

                # 🔑 Timestamp do Firestore
                "data_criacao": firestore.SERVER_TIMESTAMP,
                "ultima_atualizacao": firestore.SERVER_TIMESTAMP,

                "quantidade": quantidade,
                "medida": unidade,
                "unidade": unidade,
                "valor_unitario": valor_unit,
            }

            print("[DEBUG CADASTRO] Gravando item_data:", item_data)
            doc_ref.set(item_data)
            print("[CADASTRO] gravado", doc_ref.id)

            flash("Item cadastrado com sucesso!", "success")
            return redirect(url_for("cadastro"))

        except Exception as e:
            flash(f"Erro ao cadastrar: {str(e)}", "danger")
            return render_template("cadastro.html")

    # GET → renderiza formulário
    return render_template("cadastro.html")
@app.route('/meus-produtos')
def meusProdutos():
    try:
        produtos_ref = db.collection('produtos').order_by(
            'data_criacao', direction=firestore.Query.DESCENDING
        )
        produtos = []
        for doc in produtos_ref.stream():
            data = doc.to_dict()
            data['id'] = doc.id
            produtos.append(data)

        # Renderiza a página passando a lista de produtos
        return render_template('meus_produtos.html', produtos=produtos)

    except Exception as e:
        return f"Erro ao carregar produtos: {str(e)}", 500

# @app.route('/criar-itens', methods=['POST'])
# def criar_itens():
#     """Docstring removida para otimização"""
#     try:
#         body = request.get_json(silent=True) or {}
#         itens = body.get('itens')
#         if not isinstance(itens, list) or not itens:
#             return jsonify({'error': 'Envie um array "itens" com pelo menos um item'}), 400

#         def to_float(x):
#             try:
#                 return float(str(x).replace(',', '.'))
#             except Exception:
#                 return None

#         # 1) normaliza e valida
#         clean = []
#         for idx, it in enumerate(itens):
#             if not isinstance(it, dict):
#                 return jsonify({'error': f'Item na posição {idx} inválido'}), 400

#             nome = (it.get('nome') or '').strip()
#             unidade = (it.get('unidade') or '').strip()
#             valor_unitario = to_float(it.get('valor_unitario'))
#             data_emissao = (it.get('data_emissao') or '').strip()
#             fornecedor = (it.get('fornecedor') or '').strip()
#             codigo = it.get('codigo')
#             codigo = (codigo if codigo not in ('', None) else None)

#             if not nome or not unidade or valor_unitario is None or not data_emissao:
#                 return jsonify({'error': f'Campos obrigatórios ausentes no item {idx+1}'}), 400

#             clean.append({
#                 'idx': idx,
#                 'codigo': codigo,
#                 'nome': nome,
#                 'unidade': unidade,
#                 'valor_unitario': valor_unitario,
#                 'data_emissao': data_emissao
#             })

#         # 2) checa duplicatas no Firestore
#         conflicts = []
#         col = db.collection('itens')
#         for c in clean:
#             q = (col.where('nome', '==', c['nome'])
#                     .where('unidade', '==', c['unidade'])
#                     .where('valor_unitario', '==', c['valor_unitario'])
#                     .where('data_emissao', '==', c['data_emissao']))
#             if c['codigo'] is not None:
#                 q = q.where('codigo', '==', c['codigo'])

#             # OBS: isso pode exigir criar um índice composto no Firestore
#             # Se aparecer um erro de índice, siga o link que o console/log do Firestore sugerir.
#             exists = next(q.limit(1).stream(), None)
#             if exists is not None:
#                 conflicts.append({
#                     'index': c['idx'],
#                     'item': {
#                         'codigo': c['codigo'],
#                         'nome': c['nome'],
#                         'unidade': c['unidade'],
#                         'valor_unitario': c['valor_unitario'],
#                         'data_emissao': c['data_emissao']
#                     }
#                 })

#         if conflicts:
#             return jsonify({'success': False, 'conflicts': conflicts}), 409

#         # 3) grava em batch (atômico)
#         batch = db.batch()
#         now_fields = {
#             'data_criacao': firestore.SERVER_TIMESTAMP,
#             'ultima_atualizacao': firestore.SERVER_TIMESTAMP
#         }
#         for c in clean:
#             doc = {
#                 'codigo': c['codigo'],
#                 'nome': c['nome'],
#                 'unidade': c['unidade'],
#                 'valor_unitario': c['valor_unitario'],
#                 'data_emissao': c['data_emissao'],
#                 **now_fields
#             }
#             ref = col.document()
#             batch.set(ref, doc)

#         batch.commit()
#         return jsonify({'success': True, 'created': len(clean)}), 201

#     except Exception as e:
#         return jsonify({'error': str(e)}), 500

@app.route('/criar-itens', methods=['POST'])
@app.route('/criar-itens', methods=['POST'])
def criar_itens():
    try:
        body = request.get_json(silent=True) or {}
        itens = body.get('itens')
        if not isinstance(itens, list) or not itens:
            return jsonify({'error': 'Envie um array "itens" com pelo menos um item'}), 400

        def to_float(x):
            try:
                return float(str(x).replace(',', '.'))
            except Exception:
                return None

        # Buscar códigos existentes na base ANTES de processar os itens
        existing_codes = set()
        try:
            docs = db.collection('itens').select(['codigo']).stream()
            for doc in docs:
                data = doc.to_dict()
                if data.get('codigo'):
                    existing_codes.add(str(data['codigo']))
        except Exception as e:
            print(f"AVISO: Não foi possível buscar códigos existentes: {e}")

        clean = []
        for idx, it in enumerate(itens):
            if not isinstance(it, dict):
                return jsonify({'error': f'Item na posição {idx} inválido'}), 400

            nome = (it.get('nome') or '').strip()
            unidade = (it.get('unidade') or '').strip()
            valor_unitario = to_float(it.get('valor_unitario'))
            data_emissao = (it.get('data_emissao') or '').strip()
            fornecedor = (it.get('fornecedor') or '').strip()
            codigo = it.get('codigo')
            
            # LÓGICA DE CÓDIGO NUMÉRICO RANDÔMICO
            codigo_final = codigo
            # Se não tem código ou está vazio, gera um numérico único
            if not codigo_final or codigo_final.strip() == '':
                codigo_final = gerar_codigo_unico(existing_codes)
                existing_codes.add(codigo_final)  # Adiciona para evitar duplicatas no batch
            # Se tem código mas é muito curto (menos de 4 dígitos), também gera um novo
            elif len(str(codigo_final).strip()) < 4:
                codigo_final = gerar_codigo_unico(existing_codes)
                existing_codes.add(codigo_final)

            if not nome or not unidade or valor_unitario is None or not data_emissao or not fornecedor:
                return jsonify({'error': f'Campos obrigatórios ausentes no item {idx+1}'}), 400

            clean.append({
                'idx': idx,
                'codigo': codigo_final,  # Usa o código final (original ou gerado)
                'nome': nome,
                'unidade': unidade,
                'valor_unitario': valor_unitario,
                'data_emissao': data_emissao,
                'fornecedor': fornecedor
            })

        conflicts = []
        col = db.collection('itens')
        for c in clean:
            q = (col.where('nome', '==', c['nome'])
                    .where('unidade', '==', c['unidade'])
                    .where('valor_unitario', '==', c['valor_unitario'])
                    .where('data_emissao', '==', c['data_emissao'])
                    .where('fornecedor', '==', c['fornecedor']))
            # Sempre verifica pelo código (agora sempre tem código)
            q = q.where('codigo', '==', c['codigo'])
            
            exists = next(q.limit(1).stream(), None)
            if exists is not None:
                conflicts.append({
                    'index': c['idx'],
                    'item': {
                        'codigo': c['codigo'],
                        'nome': c['nome'],
                        'unidade': c['unidade'],
                        'valor_unitario': c['valor_unitario'],
                        'data_emissao': c['data_emissao'],
                        'fornecedor': c['fornecedor']
                    }
                })

        if conflicts:
            return jsonify({'success': False, 'conflicts': conflicts}), 409

        batch = db.batch()
        now_fields = {
            'data_criacao': firestore.SERVER_TIMESTAMP,
            'ultima_atualizacao': firestore.SERVER_TIMESTAMP
        }

        for c in clean:
            doc = {
                'codigo': c['codigo'],
                'nome': c['nome'],
                'unidade': c['unidade'],
                'valor_unitario': c['valor_unitario'],
                'data_emissao': c['data_emissao'],
                'fornecedor': c['fornecedor'],
                **now_fields
            }
            ref = col.document()
            batch.set(ref, doc)

        batch.commit()
        return jsonify({'success': True, 'created': len(clean)}), 201

    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/produto')
def produto():
    return render_template('produto.html')

# >>> ROTA QUE FALTAVA <<<
@app.route('/upload')
def upload():
    return render_template('uplaod.html')

@app.route('/upload-arquivo', methods=['POST'])
def upload_arquivo():
    if 'xmlFile' not in request.files:
        return jsonify({'error': 'Nenhum arquivo enviado'}), 400

    file = request.files['xmlFile']
    if not file or file.filename == '':
        return jsonify({'error': 'Nome de arquivo vazio'}), 400

    filename_lower = file.filename.lower()
    
    if not (filename_lower.endswith('.xml') or filename_lower.endswith('.pdf')):
        return jsonify({'error': 'Formato de arquivo inválido. Use XML ou PDF.'}), 400

    os.makedirs('temp', exist_ok=True)
    temp_path = os.path.join('temp', secure_filename(file.filename))
    
    try:
        file.save(temp_path)
        app.logger.info(f'Arquivo {file.filename} salvo temporariamente')

        # Processar de acordo com o tipo de arquivo
        if filename_lower.endswith('.xml'):
            app.logger.info("Processando como XML")
            dados = extrair_dados_xml(temp_path)
        else:
            app.logger.info("Processando como PDF")
            dados = extrair_dados_pdf(temp_path)
            
            # DEBUG: Log dos dados extraídos do PDF
            if isinstance(dados, list):
                app.logger.info(f"Dados extraídos do PDF: {len(dados)} itens")
                for i, item in enumerate(dados):
                    app.logger.info(f"Item {i}: {item.get('nome', 'Sem nome')} - R$ {item.get('valor_unitario', 0)}")
            else:
                app.logger.info(f"Erro no PDF: {dados}")

        # Verificar se retornou erro
        if isinstance(dados, dict) and 'error' in dados:
            app.logger.error(f"Erro no processamento: {dados['error']}")
            return jsonify({'error': dados['error']}), 400
            
        app.logger.info(f"Processamento bem-sucedido: {len(dados)} itens encontrados")
        return jsonify(dados), 200
        
    except Exception as e:
        app.logger.error(f"Erro no upload: {str(e)}", exc_info=True)
        return jsonify({'error': f'Erro interno no servidor: {str(e)}'}), 500
    finally:
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception as e:
            app.logger.warning(f"Erro ao remover arquivo temporário: {e}")
            
@app.route('/debug-pdf', methods=['POST'])
def debug_pdf():
    """
    Rota para debug - mostra exatamente o que o pdfplumber está vendo
    """
    if 'xmlFile' not in request.files:
        return jsonify({'error': 'Nenhum arquivo enviado'}), 400

    file = request.files['xmlFile']
    if not file or file.filename == '':
        return jsonify({'error': 'Nome de arquivo vazio'}), 400

    if not file.filename.lower().endswith('.pdf'):
        return jsonify({'error': 'Apenas PDF permitido'}), 400

    os.makedirs('temp', exist_ok=True)
    temp_path = os.path.join('temp', secure_filename(file.filename))
    
    try:
        file.save(temp_path)
        
        with pdfplumber.open(temp_path) as pdf:
            primeira_pagina = pdf.pages[0]
            
            # Extrair texto completo
            texto_completo = primeira_pagina.extract_text()
            
            # Extrair tabelas
            tabelas = primeira_pagina.extract_tables()
            
            # Extrair palavras com coordenadas
            palavras = primeira_pagina.extract_words()
            
            debug_info = {
                'texto_completo': texto_completo,
                'numero_tabelas': len(tabelas),
                'tabelas': [],
                'palavras': palavras[:50]  # Primeiras 50 palavras
            }
            
            for i, tabela in enumerate(tabelas):
                debug_info['tabelas'].append({
                    'indice': i,
                    'numero_linhas': len(tabela),
                    'cabecalho': tabela[0] if tabela else [],
                    'primeiras_linhas': tabela[1:4] if len(tabela) > 1 else []
                })
            
            return jsonify(debug_info)
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except:
            pass
        
@app.route('/teste-pdf', methods=['POST'])
def teste_pdf():
    """
    Rota para testar extração específica do PDF
    """
    if 'xmlFile' not in request.files:
        return jsonify({'error': 'Nenhum arquivo enviado'}), 400

    file = request.files['xmlFile']
    if not file or file.filename == '':
        return jsonify({'error': 'Nome de arquivo vazio'}), 400

    if not file.filename.lower().endswith('.pdf'):
        return jsonify({'error': 'Apenas PDF permitido'}), 400

    os.makedirs('temp', exist_ok=True)
    temp_path = os.path.join('temp', secure_filename(file.filename))
    
    try:
        file.save(temp_path)
        
        with pdfplumber.open(temp_path) as pdf:
            primeira_pagina = pdf.pages[0]
            texto_completo = primeira_pagina.extract_text()
            
            # Mostrar estrutura das tabelas
            tabelas = primeira_pagina.extract_tables()
            info_tabelas = []
            
            for i, tabela in enumerate(tabelas):
                info_tabelas.append({
                    'indice': i,
                    'numero_colunas': len(tabela[0]) if tabela else 0,
                    'numero_linhas': len(tabela),
                    'cabecalho': tabela[0] if tabela else [],
                    'primeira_linha_dados': tabela[1] if len(tabela) > 1 else []
                })
            
            # Tentar extrair produtos
            from pdf_processor import extrair_dados_pdf
            produtos = extrair_dados_pdf(temp_path)
            
            resultado = {
                'texto_amostra': texto_completo[:1000] + "..." if len(texto_completo) > 1000 else texto_completo,
                'tabelas_encontradas': info_tabelas,
                'produtos_extraidos': produtos if isinstance(produtos, list) else produtos
            }
            
            return jsonify(resultado)
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except:
            pass

@app.route('/upload-xml', methods=['POST'])
def upload_xml():
    """Rota legada para compatibilidade - apenas XML"""
    if 'xmlFile' not in request.files:
        return jsonify({'error': 'Nenhum arquivo enviado'}), 400

    file = request.files['xmlFile']
    if not file or file.filename == '':
        return jsonify({'error': 'Nome de arquivo vazio'}), 400

    if not file.filename.lower().endswith('.xml'):
        return jsonify({'error': 'Formato de arquivo inválido. Use XML.'}), 400

    os.makedirs('temp', exist_ok=True)
    temp_path = os.path.join('temp', secure_filename(file.filename))
    try:
        file.save(temp_path)
        app.logger.info(f'Arquivo salvo temporariamente em: {temp_path}')

        dados = extrair_dados_xml(temp_path)
        status = 200 if isinstance(dados, list) else 400
        return jsonify(dados), status
    except Exception as e:
        return jsonify({'error': f'Erro interno: {str(e)}'}), 500
    finally:
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception:
            pass
        
@app.route('/criar-produto', methods=['POST'])
def criar_produto():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'error': 'Dados não fornecidos'}), 400

        nome = (data.get('nomeProduto') or '').strip()
        insumos = data.get('insumos') or []
        if not nome:
            return jsonify({'error': 'Campo obrigatório faltando: nomeProduto'}), 400
        if not isinstance(insumos, list) or not insumos:
            return jsonify({'error': 'Informe ao menos um insumo'}), 400

        # 1) DUPLICADO? (case-insensitive)
        nome_lower = nome.casefold()
        produtos_ref = db.collection('produtos')
        dup = next(produtos_ref.where('nome_lower', '==', nome_lower).limit(1).stream(), None)
        if dup is not None:
            # 409 Conflict, NÃO grava
            return jsonify({
                'success': False,
                'error': 'Já existe um produto com esse nome.'
            }), 409

        # 2) Normaliza e recalcula total no servidor
        clean_insumos = []
        total = 0.0
        for idx, it in enumerate(insumos, start=1):
            try:
                v_unit = float(str(it.get('valor_unitario', 0)).replace(',', '.'))
                qtd = float(str(it.get('quantidade', 0)).replace(',', '.'))
            except Exception:
                return jsonify({'error': f'Insumo {idx}: valores inválidos'}), 400
            subtotal = v_unit * qtd
            total += subtotal
            clean_insumos.append({
                'id_item': it.get('id_item'),
                'nome': it.get('nome'),
                'unidade': it.get('unidade'),
                'valor_unitario': v_unit,
                'quantidade': qtd,
                'subtotal': subtotal,
                'fornecedor': it.get('fornecedor')  # 👈 NOVO CAMPO
            })

        # 3) Grava
        produto_ref = produtos_ref.document()
        produto_data = {
            'nome': nome,
            'nome_lower': nome_lower,  # usado para evitar duplicados (case-insensitive)
            'insumos': clean_insumos,
            'custo_total': total,
            'data_criacao': firestore.SERVER_TIMESTAMP,
            'ultima_atualizacao': firestore.SERVER_TIMESTAMP,
            'fornecedor': it.get('fornecedor')  # 👈 NOVO CAMPO
        }
        produto_ref.set(produto_data)

        # 4) Resposta sem sentinels
        return jsonify({'success': True, 'id': produto_ref.id}), 201

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/listar-produtos', methods=['GET'])
def listar_produtos():
    try:
        produtos_ref = db.collection('produtos').order_by('data_criacao', direction=firestore.Query.DESCENDING).limit(20)
        produtos = [doc.to_dict() for doc in produtos_ref.stream()]
        return jsonify(produtos)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Alias opcional para alinhar com o front antigo
@app.route('/produtos', methods=['GET'])
def produtos_alias():
    return listar_produtos()

@app.route('/produtos/<doc_id>', methods=['DELETE'])
def delete_produto(doc_id):
    try:
        ref = db.collection('produtos').document(doc_id)
        snap = ref.get()
        if not snap.exists:
            return jsonify({'success': False, 'error': 'Produto não encontrado'}), 404

        ref.delete()
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/itens/<doc_id>', methods=['PATCH', 'DELETE'])
def itens_update_delete(doc_id):
    try:
        ref = db.collection('itens').document(doc_id)
        snap = ref.get()
        if not snap.exists:
            return jsonify({'success': False, 'error': 'Item não encontrado'}), 404

        if request.method == 'DELETE':
            ref.delete()
            return jsonify({'success': True}), 200

        # PATCH
        body = request.get_json(silent=True) or {}
        allowed = {'nome', 'unidade', 'valor_unitario', 'codigo'}
        update_data = {k: v for k, v in body.items() if k in allowed}

        # Normaliza valor_unitario se vier como string com vírgula
        if 'valor_unitario' in update_data:
            try:
                update_data['valor_unitario'] = float(str(update_data['valor_unitario']).replace(',', '.'))
            except Exception:
                return jsonify({'success': False, 'error': 'valor_unitario inválido'}), 400

        if not update_data:
            return jsonify({'success': False, 'error': 'Nenhuma mudança válida enviada'}), 400

        update_data['atualizado_em'] = datetime.utcnow()
        ref.update(update_data)
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/cadastro_manual')
def cadastro_manual():
    return render_template('cadastro_manual.html')

# rota atualizar quatidade produto
@app.route('/produtos/<string:produto_id>/insumos/<string:insumo_id>', methods=['PUT'])
def atualizar_insumo(produto_id, insumo_id):
    try:
        data = request.get_json()
        nova_quantidade = data.get('quantidade')

        produto_ref = db.collection('produtos').document(produto_id)
        produto_doc = produto_ref.get()

        if not produto_doc.exists:
            return jsonify({'error': 'Produto não encontrado'}), 404

        produto_data = produto_doc.to_dict()
        insumos = produto_data.get('insumos', [])
        historico = produto_data.get('historico_valores', [])

        valor_total_anterior = produto_data.get('custo_total', 0)

        insumo_encontrado = False
        nome_insumo_alterado = None
        for insumo in insumos:
            if insumo.get('id_item') == insumo_id:
                quantidade_antiga = insumo.get('quantidade', 0)
                fornecedor = insumo.get('fornecedor', '')  # 👈 NOVO
                insumo['quantidade'] = nova_quantidade
                insumo['subtotal'] = float(nova_quantidade) * float(insumo.get('valor_unitario', 0))
                nome_insumo_alterado = insumo.get('nome')
                insumo_encontrado = True
                break
        if not insumo_encontrado:
            return jsonify({'error': 'Insumo não encontrado'}), 404

        novo_custo_total = sum(insumo['subtotal'] for insumo in insumos)

        historico.append({
            'valor_antigo': valor_total_anterior,
            'quantidade_antiga': quantidade_antiga,  # 👈 NOVO CAMPO
            'fornecedor': fornecedor,  # 👈 NOVO
            'data': datetime.now().strftime('%d/%m/%Y %H:%M:%S'),
            'insumo': nome_insumo_alterado
        })

        produto_ref.update({
            'insumos': insumos,
            'custo_total': novo_custo_total,
            'historico_valores': historico
        })

        return jsonify({
            'message': 'Quantidade atualizada com sucesso',
            'nova_quantidade': nova_quantidade,
            'custo_total_atualizado': novo_custo_total
        }), 200

    except Exception as e:
        return jsonify({'error': f'Erro interno: {str(e)}'}), 500

@app.route('/materiais', methods = ['GET'])
def listar_materiais():
    try:
        itens_ref = db.collection('itens')
        docs = list(itens_ref.stream())  # 👈 transforma em lista para garantir que pode ser iterado

        itens = []
        for doc in docs:
            item = doc.to_dict() if doc.exists else {}
            itens.append({
                'id': doc.id,
                'nome': item.get('nome', ''),
                'fornecedor': item.get('fornecedor', ''),
                'unidade': item.get('unidade', ''),
                'valor_unitario': float(item.get('valor_unitario') or 0.0),
                'data_emissao': item.get('data_emissao', '')
            })

        return render_template('listar_materia_prima.html', itens=itens)

    except Exception as e:
        erro_msg = f'Erro ao buscar itens: {str(e)}'
        return render_template('erro.html', mensagem=erro_msg), 500
# rota para ver histórico
@app.route('/produtos/<string:produto_id>', methods=['GET'])
def buscar_produto(produto_id):
    produto_ref = db.collection('produtos').document(produto_id)
    produto_doc = produto_ref.get()

    if not produto_doc.exists:
        return jsonify({'error': 'Produto não encontrado'}), 404

    return jsonify(produto_doc.to_dict()), 200
@app.route('/itens', methods=['GET'])

def listar_itens_view():
    """Docstring removida para otimização"""
    return render_template('listar_itens.html')
if __name__ == '__main__':
    app.run(debug=True)