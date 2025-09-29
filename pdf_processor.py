import pdfplumber
from datetime import datetime
import re
import random
import string

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

def extrair_dados_pdf(pdf_file):
    """
    Extrai dados de notas fiscais em PDF - versão específica para o formato da MCM Bobinas
    """
    try:
        with pdfplumber.open(pdf_file) as pdf:
            primeira_pagina = pdf.pages[0]
            
            # Extrair todo o texto para análise
            texto_completo = primeira_pagina.extract_text()
            
            # DEBUG: Mostrar trecho do texto para análise
            print("=== DEBUG: Trecho do texto do PDF ===")
            print(texto_completo[:1500])
            print("=====================================")
            
            # Extrair informações do emitente (quem emitiu a nota) - CORREÇÃO AQUI
            emitente_info = extrair_emitente_corrigido(texto_completo)
            
            # Extrair dados dos produtos
            itens = extrair_produtos_especifico(primeira_pagina, texto_completo, emitente_info)
            
            if not itens:
                return {'error': 'Não foi possível identificar os produtos no PDF'}
            
            return itens

    except Exception as e:
        import traceback
        print(f"Erro detalhado: {traceback.format_exc()}")
        return {'error': f'Erro ao processar PDF: {str(e)}'}

def extrair_emitente_corrigido(texto_completo):
    """
    Extrai informações do EMITENTE de forma correta - REVISADO
    """
    emitente_info = {
        'nome': '',
        'cnpj': '',
        'data_emissao': ''
    }
    
    try:
        # CORREÇÃO 1: Extrair DATA DE EMISSÃO primeiro
        padrao_data = r'DATA\s+DA\s+EMISSÃO\s*(\d{2}/\d{2}/\d{4})'
        match_data = re.search(padrao_data, texto_completo)
        if match_data:
            data_br = match_data.group(1)
            partes = data_br.split('/')
            if len(partes) == 3:
                emitente_info['data_emissao'] = f"{partes[2]}-{partes[1]}-{partes[0]}"
                print(f"DEBUG: Data extraída: {emitente_info['data_emissao']}")
        else:
            padrao_data_fallback = r'(\d{2}/\d{2}/\d{4})'
            matches = re.findall(padrao_data_fallback, texto_completo)
            for data in matches:
                partes = data.split('/')
                if len(partes) == 3 and int(partes[2]) >= 2020:
                    emitente_info['data_emissao'] = f"{partes[2]}-{partes[1]}-{partes[0]}"
                    print(f"DEBUG: Data fallback: {emitente_info['data_emissao']}")
                    break
        
        if not emitente_info['data_emissao']:
            emitente_info['data_emissao'] = datetime.now().strftime('%Y-%m-%d')
            print("DEBUG: Usando data atual")

        # CORREÇÃO 2: Extrair NOME DO EMITENTE dinamicamente do PDF
        # Estratégia: Encontrar "IDENTIFICAÇÃO DO EMITENTE" e pegar as próximas linhas
        linhas = texto_completo.split('\n')
        
        for i, linha in enumerate(linhas):
            if 'IDENTIFICAÇÃO DO EMITENTE' in linha.upper():
                # Pegar as próximas linhas até encontrar uma linha vazia ou outro cabeçalho
                nome_emitente = ""
                for j in range(i + 1, min(i + 5, len(linhas))):  # Verificar próximas 5 linhas
                    linha_atual = linhas[j].strip()
                    
                    # Parar se encontrar outro cabeçalho importante
                    if any(cabecalho in linha_atual.upper() for cabecalho in 
                          ['DANFE', 'CHAVE DE ACESSO', '0 - ENTRADA', '1 - SAÍDA', 'NATUREZA']):
                        break
                    
                    # Se a linha não estiver vazia e não for um cabeçalho, adicionar ao nome
                    if linha_atual and not re.match(r'^[\d\s\-]+$', linha_atual):
                        if nome_emitente:
                            nome_emitente += " " + linha_atual
                        else:
                            nome_emitente = linha_atual
                
                if nome_emitente:
                    # Limpar o nome - REMOVER "Documento Auxiliar da Nota Fiscal Eletrônica" e outros textos
                    nome_emitente = re.sub(r'\s+', ' ', nome_emitente.strip())
                    # Remover textos específicos que não fazem parte do nome do emitente
                    nome_emitente = re.sub(r'Documento Auxiliar da Nota Fiscal Eletrônica', '', nome_emitente, flags=re.IGNORECASE)
                    nome_emitente = re.sub(r'DANFE', '', nome_emitente, flags=re.IGNORECASE)
                    nome_emitente = re.sub(r'\s*RUA.*', '', nome_emitente)
                    nome_emitente = re.sub(r'\s*BAURU.*', '', nome_emitente)
                    nome_emitente = re.sub(r'\s*[\d\-]+$', '', nome_emitente)  # Remove CEP no final
                    nome_emitente = re.sub(r'\s+', ' ', nome_emitente.strip())  # Remove espaços múltiplos novamente
                    emitente_info['nome'] = nome_emitente.strip()
                    print(f"DEBUG: Emitente extraído dinamicamente: {emitente_info['nome']}")
                    break

        # Se não encontrou dinamicamente, tentar regex como fallback
        if not emitente_info['nome']:
            padrao_emitente = r'IDENTIFICAÇÃO\s+DO\s+EMITENTE\s*([^\n]+(?:\n[^\n]+){0,2})'
            match_emitente = re.search(padrao_emitente, texto_completo, re.IGNORECASE)
            if match_emitente:
                nome_emitente = match_emitente.group(1).strip()
                # Limpar quebras de linha e remover textos indesejados
                nome_emitente = re.sub(r'\n', ' ', nome_emitente)
                nome_emitente = re.sub(r'Documento Auxiliar da Nota Fiscal Eletrônica', '', nome_emitente, flags=re.IGNORECASE)
                nome_emitente = re.sub(r'DANFE', '', nome_emitente, flags=re.IGNORECASE)
                nome_emitente = re.sub(r'\s+', ' ', nome_emitente)
                emitente_info['nome'] = nome_emitente.strip()
                print(f"DEBUG: Emitente fallback regex: {emitente_info['nome']}")

        # CORREÇÃO 3: Extrair CNPJ DO EMITENTE dinamicamente
        # Procurar CNPJ após o nome do emitente ou na seção de identificação
        if emitente_info['nome']:
            # Encontrar a posição do nome do emitente no texto
            pos_nome = texto_completo.find(emitente_info['nome'])
            if pos_nome != -1:
                # Procurar CNPJ após o nome do emitente
                texto_apos_emitente = texto_completo[pos_nome + len(emitente_info['nome']):pos_nome + 500]
                cnpjs = re.findall(r'(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})', texto_apos_emitente)
                if cnpjs:
                    emitente_info['cnpj'] = cnpjs[0]
                    print(f"DEBUG: CNPJ extraído após emitente: {emitente_info['cnpj']}")
        
        # Fallback para CNPJ - procurar todos os CNPJs no texto
        if not emitente_info['cnpj']:
            cnpjs = re.findall(r'(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})', texto_completo)
            if cnpjs:
                # Tentar identificar qual CNPJ é do emitente
                for cnpj in cnpjs:
                    # Verificar se o CNPJ está próximo do nome do emitente
                    pos_cnpj = texto_completo.find(cnpj)
                    pos_emitente = texto_completo.find(emitente_info['nome']) if emitente_info['nome'] else -1
                    
                    if pos_emitente != -1 and abs(pos_cnpj - pos_emitente) < 1000:
                        emitente_info['cnpj'] = cnpj
                        print(f"DEBUG: CNPJ selecionado por proximidade: {emitente_info['cnpj']}")
                        break
                
                # Se não encontrou por proximidade, usar o primeiro
                if not emitente_info['cnpj'] and cnpjs:
                    emitente_info['cnpj'] = cnpjs[0]
                    print(f"DEBUG: CNPJ fallback (primeiro encontrado): {emitente_info['cnpj']}")

        # DEBUG final
        print(f"=== DEBUG FINAL ===")
        print(f"Nome: {emitente_info['nome']}")
        print(f"CNPJ: {emitente_info['cnpj']}")
        print(f"Data: {emitente_info['data_emissao']}")
        print(f"====================")
                
    except Exception as e:
        print(f"Erro ao extrair emitente: {e}")
        # Valores padrão mínimos em caso de erro
        if not emitente_info['data_emissao']:
            emitente_info['data_emissao'] = datetime.now().strftime('%Y-%m-%d')
    
    return emitente_info

def extrair_produtos_especifico(pagina, texto_completo, emitente_info):
    """
    Extrai produtos especificamente do formato MCM Bobinas
    """
    itens = []
    
    # Primeiro, tentar extrair da tabela estruturada
    tabelas = pagina.extract_tables()
    
    for tabela in tabelas:
        if len(tabela) < 2:
            continue
            
        # Verificar se é a tabela de produtos (procura pelo cabeçalho)
        cabecalho = ' '.join([str(c) for c in tabela[0] if c]).upper()
        
        if any(palavra in cabecalho for palavra in ['CÓDIGO PRODUTO', 'DESCRIÇÃO', 'QUANT', 'VALOR UNIT']):
            print("Encontrada tabela de produtos!")
            
            for linha in tabela[1:]:
                if not linha or len(linha) < 7:
                    continue
                    
                # Verificar se a linha contém dados de produto
                item = processar_linha_produto(linha, emitente_info)
                if item and validar_item(item):
                    itens.append(item)
    
    # Se não encontrou na tabela, tentar extrair do texto
    if not itens:
        itens = extrair_produtos_do_texto(texto_completo, emitente_info)
    
    return itens

def processar_linha_produto(linha, emitente_info):
    """
    Processa uma linha da tabela de produtos
    """
    try:
        # A estrutura baseada no seu PDF parece ser:
        # [0] Código, [1] Descrição, [2] NCM, [3] CST, [4] CFOP, [5] UN, [6] Quantidade, [7] Valor Unitário, [8] Valor Total
        
        codigo = str(linha[0] or "").strip()
        descricao = str(linha[1] or "").strip()
        unidade = str(linha[5] or "").strip() if len(linha) > 5 else "CT"
        quantidade_str = str(linha[6] or "0").strip() if len(linha) > 6 else "0"
        valor_unitario_str = str(linha[7] or "0").strip() if len(linha) > 7 else "0"
        
        # Validar se é um produto real
        if not descricao or descricao in ['', 'None', 'nan']:
            return None
            
        # Processar valores
        quantidade = converter_para_float(quantidade_str)
        valor_unitario = converter_para_float(valor_unitario_str)
        
        # LÓGICA DE CÓDIGO NUMÉRICO RANDÔMICO
        # Buscar códigos existentes na base
        existing_codes = set()
        try:
            docs = db.collection('itens').select(['codigo']).stream()
            for doc in docs:
                data = doc.to_dict()
                if data.get('codigo'):
                    existing_codes.add(str(data['codigo']))
        except Exception as e:
            print(f"AVISO: Não foi possível buscar códigos existentes: {e}")
        
        codigo_final = codigo
        # Se não tem código no PDF ou está vazio, gera um numérico único
        if not codigo_final or codigo_final.strip() == '':
            codigo_final = gerar_codigo_unico(existing_codes)
        # Se tem código mas é muito curto (menos de 4 dígitos), também gera um novo
        elif len(str(codigo_final).strip()) < 4:
            codigo_final = gerar_codigo_unico(existing_codes)
        # Se o código começar com "PDF_" (do fallback anterior), gera um numérico
        elif codigo_final.startswith('PDF_'):
            codigo_final = gerar_codigo_unico(existing_codes)
        
        return {
            'codigo': codigo_final,  # Agora sempre tem código numérico
            'nome': descricao,
            'unidade': unidade,
            'quantidade': quantidade,
            'valor_unitario': valor_unitario,
            'data_emissao': emitente_info['data_emissao'],  # Usa a data extraída do PDF
            'fornecedor': emitente_info['nome'],  # Usa o nome do EMITENTE
            'cnpj_fornecedor': emitente_info['cnpj'],
            'timestamp': datetime.now().isoformat()
        }
        
    except Exception as e:
        print(f"Erro ao processar linha: {e}")
        return None

def extrair_produtos_do_texto(texto_completo, emitente_info):
    """
    Extrai produtos diretamente do texto quando a tabela não é detectada corretamente
    """
    itens = []
    
    # Procurar a seção de produtos no texto
    padrao_produtos = r'DADOS DOS PRODUTOS / SERVIÇOS(.*?)DADOS ADICIONAIS'
    match = re.search(padrao_produtos, texto_completo, re.DOTALL | re.IGNORECASE)
    
    if not match:
        return itens
    
    secao_produtos = match.group(1)
    
    # Procurar linhas de produtos - padrão específico do seu PDF
    # Formato: código descrição NCM CST CFOP UN quantidade valor_unitario valor_total ...
    linhas_produtos = re.findall(r'(\d{6})\s+(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+([A-Z]{2})\s+([\d.,]+)\s+([\d.,]+)', secao_produtos)
    
    for linha in linhas_produtos:
        codigo, descricao, ncm, cst, cfop, unidade, quant_str, valor_str = linha
        
        # Limpar descrição
        descricao_limpa = descricao.strip()
        
        # Processar valores
        quantidade = converter_para_float(quant_str)
        valor_unitario = converter_para_float(valor_str)
        
        item = {
            'codigo': codigo,
            'nome': descricao_limpa,
            'unidade': unidade,
            'quantidade': quantidade,
            'valor_unitario': valor_unitario,
            'data_emissao': emitente_info['data_emissao'],  # Usa a data extraída do PDF
            'fornecedor': emitente_info['nome'],  # Usa o nome do EMITENTE
            'cnpj_fornecedor': emitente_info['cnpj'],
            'timestamp': datetime.now().isoformat()
        }
        
        if validar_item(item):
            itens.append(item)
    
    return itens

def converter_para_float(valor_str):
    """
    Converte string para float, tratando formatos brasileiros
    """
    try:
        if not valor_str or valor_str in ['', 'None', 'nan']:
            return 0.0
        
        # Remove R$ e espaços
        valor_limpo = str(valor_str).replace('R$', '').replace(' ', '').strip()
        
        # Verificar formato brasileiro (1.234,56)
        if '.' in valor_limpo and ',' in valor_limpo:
            partes = valor_limpo.split(',')
            if len(partes) == 2:
                inteiro = partes[0].replace('.', '')
                return float(f"{inteiro}.{partes[1]}")
        
        # Formato simples com vírgula (1234,56)
        if ',' in valor_limpo:
            return float(valor_limpo.replace(',', '.'))
        
        # Formato padrão (1234.56)
        return float(valor_limpo)
        
    except (ValueError, TypeError):
        return 0.0

def validar_item(item):
    """
    Valida se o item extraído é realmente um produto
    """
    try:
        # Verificar se tem nome válido
        if not item.get('nome') or item['nome'] == 'Sem nome':
            return False
        
        # Verificar se não é informação administrativa
        palavras_negativas = ['PROTOCOLO', 'PESO', 'LIQUIDO', 'ENDERECO', 'CHAVE', 'ACESSO', 'TOTAL']
        if any(palavra in item['nome'].upper() for palavra in palavras_negativas):
            return False
        
        # Verificar se tem valor positivo
        if item.get('valor_unitario', 0) <= 0:
            return False
        
        # Verificar se tem quantidade positiva
        if item.get('quantidade', 0) <= 0:
            return False
            
        return True
    except:
        return False