# backfill_itens.py  (pode manter seu nome, só garanta o conteúdo abaixo)
import os
import firebase_admin
from firebase_admin import credentials, firestore

def load_credentials():
    # 1) Variável FIREBASE_CREDENTIALS
    p = os.getenv("FIREBASE_CREDENTIALS")
    if p and os.path.exists(p):
        print(f"[OK] Usando credenciais de FIREBASE_CREDENTIALS: {p}")
        return credentials.Certificate(p)

    # 2) Variável GOOGLE_APPLICATION_CREDENTIALS (padrão do Google)
    p = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if p and os.path.exists(p):
        print(f"[OK] Usando credenciais de GOOGLE_APPLICATION_CREDENTIALS: {p}")
        return credentials.Certificate(p)

    # 3) Arquivo local padrão ao lado do script
    here = os.path.dirname(os.path.abspath(__file__))
    p = os.path.join(here, "firebase-key.json")
    if os.path.exists(p):
        print(f"[OK] Usando credenciais locais: {p}")
        return credentials.Certificate(p)

    raise RuntimeError(
        "Credenciais do Firebase não encontradas.\n"
        "Defina FIREBASE_CREDENTIALS ou GOOGLE_APPLICATION_CREDENTIALS "
        "com o caminho do JSON de Service Account, ou coloque 'firebase-key.json' ao lado deste script."
    )

cred = load_credentials()
firebase_admin.initialize_app(cred)
db = firestore.client()

batch = db.batch()
count = 0

# ---- backfill: ajuste conforme te passei antes ----
for doc in db.collection('itens').stream():
    data = doc.to_dict() or {}
    patch = {}

    if 'data_criacao' not in data:
        patch['data_criacao'] = firestore.SERVER_TIMESTAMP
    if 'ultima_atualizacao' not in data:
        patch['ultima_atualizacao'] = firestore.SERVER_TIMESTAMP
    if 'unidade' not in data and 'medida' in data:
        patch['unidade'] = data.get('medida')
    if 'data_emissao' not in data and 'data_compra' in data:
        patch['data_emissao'] = data.get('data_compra')

    if patch:
        batch.update(doc.reference, patch)
        count += 1
        if count % 400 == 0:
            batch.commit()
            batch = db.batch()

batch.commit()
print(f"Atualizados {count} documentos.")
