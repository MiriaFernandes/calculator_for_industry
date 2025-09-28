from flask import Flask, render_template, request, redirect, url_for, flash,jsonify
import xml.etree.ElementTree as ET
import firebase_admin
from firebase_admin import credentials, firestore
import os
from datetime import datetime
from werkzeug.utils import secure_filename  # <- IMPORT NECESSÁRIO
from google.cloud.firestore_v1 import FieldFilter  # opcional, não usamos embaixo-
from dotenv import load_dotenv  # <- NOVO IMPORT
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

            lista_dados.append({
                'codigo': cprod or None,             # NOVO
                'nome': nome,
                'unidade': unidade,
                'quantidade':quantidade,
                'valor_unitario': valor_unitario,
                'data_emissao': data_emissao or None, # NOVO (replicado em cada item)
                'fornecedor': nome_fornecedor or None,  # 👈 NOVO CAMPO
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
        if q:
            qnorm = q.casefold()
            docs = list(col.order_by('data_criacao', direction=firestore.Query.DESCENDING).limit(1000).stream())
            items = []
            for d in docs:
                data = d.to_dict() or {}
                nome = (data.get('nome') or '').casefold()
                codigo = str(data.get('codigo') or '').casefold()
                if qnorm in nome or qnorm in codigo:
                    data['id'] = d.id
                    items.append(data)
                if len(items) >= limit:
                    break
            return jsonify({'items': items, 'next_cursor': None}), 200

        # PAGINADO
        query = col.order_by('data_criacao', direction=firestore.Query.DESCENDING).limit(limit + 1)

        if cursor_id:
            snap = col.document(cursor_id).get()
            if snap.exists:
                query = query.start_after(snap)

        docs_full = list(query.stream())
        has_more = len(docs_full) > limit
        docs = docs_full[:limit]

        items = []
        for d in docs:
            data = d.to_dict() or {}
            data['id'] = d.id
            items.append(data)

        next_cursor = docs[-1].id if (has_more and docs) else None
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
            codigo = (codigo if codigo not in ('', None) else None)

            if not nome or not unidade or valor_unitario is None or not data_emissao or not fornecedor:
                return jsonify({'error': f'Campos obrigatórios ausentes no item {idx+1}'}), 400

            clean.append({
                'idx': idx,
                'codigo': codigo,
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
            if c['codigo'] is not None:
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

@app.route('/upload-xml', methods=['POST'])
def upload_xml():
    if 'xmlFile' not in request.files:
        return jsonify({'error': 'Nenhum arquivo enviado'}), 400

    file = request.files['xmlFile']
    if not file or file.filename == '':
        return jsonify({'error': 'Nome de arquivo vazio'}), 400

    if not file.filename.lower().endswith('.xml'):
        return jsonify({'error': 'Formato de arquivo inválido'}), 400

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

