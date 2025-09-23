// /static/js/pages/produto.js
document.addEventListener('DOMContentLoaded', () => {
  // ===== Elementos =====
  const itensListEl = document.getElementById('itensList');
  const selecionadosTableBody = document.querySelector('#selecionadosTable tbody');
  const totalValorEl = document.getElementById('totalValor');
  const searchInput = document.getElementById('searchInput');
  const clearSearch = document.getElementById('clearSearch');
  const btnSalvarProduto = document.getElementById('btnSalvarProduto');
  const nomeProdutoEl = document.getElementById('nomeProduto');
  const openBtn = document.querySelector('.btn-materia-prima');
  const modalMateriaPrima = document.getElementById('modal-materia-prima');
  const closeMateriaPrimaBtn = document.getElementById('close-modal');
  const formMateriaPrima = document.getElementById('form-materia-prima');
  const listMateriaPrima = document.getElementById('materia-prima-list');

  const abrirSalvarModalBtn = document.getElementById('abrirSalvarModal');
  const fecharSalvarModalBtn = document.getElementById('close-salvar-modal');
  const modalSalvarProduto = document.getElementById('modal-salvar-produto');


  // Paginação
  const paginationBar = document.getElementById('paginationBar');
  const prevPageBtn = document.getElementById('prevPage');
  const nextPageBtn = document.getElementById('nextPage');
  const pageInfo = document.getElementById('pageInfo');

  // ===== Estado =====
  let itensCache = [];
  const selecionados = new Map(); // id -> {id, nome, unidade, valor_unitario, quantidade}

  // Paginação state
  const PER_PAGE = 4;
  let isSearchMode = false;
  let pageCursor = null;     // cursor atual (id do último doc da página anterior)
  let nextCursor = null;     // cursor para próxima página (id do último doc retornado)
  let cursorStack = [];      // histórico de cursores para voltar
  let pageNum = 1;

  // ===== Utils =====
  const fmt = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const toFloat = (v) => {
    if (v === null || v === undefined) return NaN;
    return parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
  };

  // Toast (top-left)
  function ensureToastContainer() {
    let c = document.querySelector('.nf-toast-container');
    if (!c) {
      c = document.createElement('div');
      c.className = 'nf-toast-container';
      document.body.appendChild(c);
    }
    return c;
  }
  function showToast({ title, description = '', variant = 'error', timeout = 4000 }) {
    const cont = ensureToastContainer();
    const el = document.createElement('div');
    el.className = `nf-toast ${variant === 'error' ? 'nf-toast--error' : 'nf-toast--success'}`;
    el.innerHTML = `
      <div class="nf-toast__row">
        <div>
          <div class="nf-toast__title">${title}</div>
          ${description ? `<div class="nf-toast__desc">${description}</div>` : ''}
        </div>
        <button class="nf-toast__close" aria-label="Fechar">&times;</button>
      </div>`;
    el.querySelector('.nf-toast__close').addEventListener('click', () => el.remove());
    cont.appendChild(el);
    if (timeout > 0) setTimeout(() => el.remove(), timeout);
  }

  // Abertura do Modal de Matéria-Prima
  // Modal matéria-prima
  if (modalMateriaPrima && closeMateriaPrimaBtn) {
    openBtn.addEventListener('click', () => modalMateriaPrima.classList.remove('hidden'));
    closeMateriaPrimaBtn.addEventListener('click', () => modalMateriaPrima.classList.add('hidden'));
    modalMateriaPrima.addEventListener('click', (e) => {
      if (e.target === modalMateriaPrima) modalMateriaPrima.classList.add('hidden');
    });

    if (formMateriaPrima && listMateriaPrima) {
      formMateriaPrima.addEventListener('submit', (e) => {
        e.preventDefault();
        // código para adicionar item
      });
    }
  }

  function renderItensList(lista) {
    itensListEl.innerHTML = '';
    if (!lista || !lista.length) {
      itensListEl.innerHTML = '<p style="color: var(--gray-color);">Nenhum item encontrado.</p>';
      return;
    }
    lista.forEach(it => {
      const div = document.createElement('div');
      div.className = 'insumo-item';
      div.innerHTML = `
        <div class="insumo-info">
          <p>${it.nome}</p>
          <p>
            ${it.codigo ? `Cód: ${it.codigo} · ` : ''}${it.unidade || ''} · ${fmt(it.valor_unitario)}
          </p>
        </div>
        <div class="insumo-actions ">
          <button data-add="${it.id}" type="button">Adicionar</button>
        </div>
      `;
      div.querySelector('[data-add]').addEventListener('click', () => {
        if (!selecionados.has(it.id)) {
          selecionados.set(it.id, {
            id: it.id,
            codigo: it.codigo, // <-- adicionado
            nome: it.nome,
            unidade: it.unidade,
            valor_unitario: Number(it.valor_unitario || 0),
            quantidade: 1
          });
          renderSelecionados(); // render quando adiciona/remover
        }
      });
      itensListEl.appendChild(div);
    });
  }

  function updatePaginationUI() {
    if (!paginationBar) return;
    if (isSearchMode) {
      prevPageBtn.disabled = true;
      nextPageBtn.disabled = true;
      pageInfo.textContent = `Resultados (${itensCache.length})`;
    } else {
      prevPageBtn.disabled = cursorStack.length === 0;
      nextPageBtn.disabled = !nextCursor;
      pageInfo.textContent = `Página ${pageNum}`;
    }
  }

  // Abertura do Modal Salvar Produto
  // Modal salvar produto
  if (abrirSalvarModalBtn && fecharSalvarModalBtn && modalSalvarProduto) {
    abrirSalvarModalBtn.addEventListener('click', () => modalSalvarProduto.classList.remove('hidden'));
    fecharSalvarModalBtn.addEventListener('click', () => modalSalvarProduto.classList.add('hidden'));
    modalSalvarProduto.addEventListener('click', (e) => {
      if (e.target === modalSalvarProduto) modalSalvarProduto.classList.add('hidden');
    });
  }

  // ===== Render =====
  function parseNumero(valor) {
    if (!valor) return 0;
    return parseFloat(valor.toString().replace(",", "."));
  }
  function recalcTotal() {
    let total = 0;
    selecionados.forEach(ins => {
      total += parseNumero(ins.valor_unitario) * parseNumero(ins.quantidade);

      // total += Number(ins.valor_unitario) * Number(ins.quantidade || 0);
    });
    totalValorEl.textContent = fmt(total);
    return total;
  }

  function renderSelecionados() {
    selecionadosTableBody.innerHTML = '';
    selecionados.forEach(ins => {

      // const subtotal = Number(ins.valor_unitario) * Number(ins.quantidade || 0);
      const subtotal = parseNumero(ins.valor_unitario) * parseNumero(ins.quantidade);

      const tr = document.createElement('tr');
      tr.setAttribute('data-id', ins.id);
      tr.setAttribute('data-vu', String(ins.valor_unitario));
      tr.innerHTML = `
      <td colspan="6" class="card-line">
        <div class="card">
          <div class="card-content">
            
            <p>Código</p>
            <p>Nome</p>
            <p>Unidade</p>
            <p>Valor unitário</p>
            <p>Quantidade</p>
            <p>Subtotal</p>
            <p>${ins.codigo}</p>
            <p >${ins.nome}</p>
            <p>${ins.unidade || ''}</p>
            <p> ${fmt(ins.valor_unitario)}</p>
            <input type="number" inputmode="decimal" lang="pt-BR" step="0.0001" min="0"
                  value="${ins.quantidade ?? 1}" data-id="${ins.id}"
                  class="quantidade-input">
           
            <p data-subtotal>${fmt(subtotal)}</p>
           
          </div>
        </div>
        <button class="btn btn-primary " data-rm="${ins.id}" type="button"><img src="../static/image/icon-close-calc.svg" alt=""></button>
      </td>
      
    `;
      selecionadosTableBody.appendChild(tr);
    });
    recalcTotal();
  }



  // ===== Delegação na tabela selecionados =====
  selecionadosTableBody.addEventListener('input', e => {
    const input = e.target.closest('input[type="number"]');
    if (!input) return;
    const id = input.getAttribute('data-id');
    const row = input.closest('tr');
    // const vUnit = Number(row.getAttribute('data-vu'));
    const qtd = toFloat(input.value);
    // const q = isNaN(qtd) ? 0 : qtd;
    // Pega valores sempre com parseNumero
    const vUnit = parseNumero(row.getAttribute('data-vu'));
    const q = parseNumero(input.value);

    // if (selecionados.has(id)) selecionados.get(id).quantidade = q;
    if (selecionados.has(id)) selecionados.get(id).quantidade = q;


    // row.querySelector('[data-subtotal]').textContent = fmt(vUnit * q);
    // row.querySelector('[data-subtotal]').textContent = fmt(
    //   parseNumero(vUnit) * parseNumero(q)
    // );
    // recalcTotal();
    row.querySelector('[data-subtotal]').textContent = fmt(vUnit * q);
recalcTotal();
  });

  selecionadosTableBody.addEventListener('click', e => {
    const btn = e.target.closest('[data-rm]');
    if (!btn) return;
    const id = btn.getAttribute('data-rm');
    if (selecionados.has(id)) {
      selecionados.delete(id);
      btn.closest('tr')?.remove();
      recalcTotal();
    }
  });

  // ===== Dados (Paginação & Busca) =====
  async function carregarItensPaged(cursor = null) {
    try {
      const url = new URL('/listar-itens', window.location.origin);
      url.searchParams.set('limit', PER_PAGE);
      if (cursor) url.searchParams.set('cursor', cursor);

      const resp = await fetch(url);
      const data = await resp.json();

      const items = data.items || (Array.isArray(data) ? data : []);
      itensCache = items;
      nextCursor = data.next_cursor || null;

      renderItensList(items);
      updatePaginationUI();
    } catch (e) {
      console.error('Erro ao listar (paginado):', e);
      itensListEl.innerHTML = '<p style="color: var(--danger-color);">Erro ao carregar itens.</p>';
    }
  }

  async function carregarItensBusca(q) {
    try {
      const url = new URL('/listar-itens', window.location.origin);
      url.searchParams.set('q', q);
      url.searchParams.set('limit', PER_PAGE * 3); // mostra mais itens na busca

      const resp = await fetch(url);
      const data = await resp.json();

      const items = data.items || (Array.isArray(data) ? data : []);
      itensCache = items;
      nextCursor = null;

      renderItensList(items);
      updatePaginationUI();
    } catch (e) {
      console.error('Erro ao buscar itens:', e);
      itensListEl.innerHTML = '<p style="color: var(--danger-color);">Erro na busca.</p>';
    }
  }

  // ===== Eventos de busca (global) =====
  const buscarDebounced = debounce(v => {
    const term = v.trim();
    if (term) {
      isSearchMode = true;
      // reseta paginação visual
      pageNum = 1;
      pageCursor = null;
      nextCursor = null;
      cursorStack = [];
      carregarItensBusca(term);
    } else {
      isSearchMode = false;
      // volta para página 1
      pageNum = 1;
      pageCursor = null;
      nextCursor = null;
      cursorStack = [];
      carregarItensPaged(null);
    }
  }, 250);

  searchInput.addEventListener('input', () => buscarDebounced(searchInput.value));
  clearSearch.addEventListener('click', () => {
    searchInput.value = '';
    buscarDebounced('');
    searchInput.focus();
  });

  // ===== Paginação (Anterior / Próxima) =====
  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => {
      if (isSearchMode || cursorStack.length === 0) return;
      // voltar: usar o cursor da página anterior
      pageCursor = cursorStack.pop() || null;
      pageNum = Math.max(1, pageNum - 1);
      carregarItensPaged(pageCursor);
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
      if (isSearchMode || !nextCursor) return;
      // ir para próxima: empilha o cursor atual
      cursorStack.push(pageCursor); // cursor que gerou a página atual
      pageCursor = nextCursor;
      pageNum += 1;
      carregarItensPaged(pageCursor);
    });
  }

  // ===== Salvar Produto =====
  btnSalvarProduto.addEventListener('click', async () => {
    const nomeProduto = (nomeProdutoEl.value || '').trim();
    if (!nomeProduto) { showToast({ title: 'Informe o nome do produto.' }); return; }
    if (selecionados.size === 0) { showToast({ title: 'Selecione ao menos um item.' }); return; }

    const insumos = [];
    selecionados.forEach(ins => {
      const quantidade = Number(ins.quantidade || 0);
      const valor_unitario = Number(ins.valor_unitario || 0);
      insumos.push({
        id_item: ins.id,
        nome: ins.nome,
        unidade: ins.unidade,
        valor_unitario,
        quantidade,
        subtotal: quantidade * valor_unitario
      });
    });

    btnSalvarProduto.disabled = true;
    const originalText = btnSalvarProduto.textContent;
    btnSalvarProduto.textContent = 'Salvando...';

    try {
      const resp = await fetch('/criar-produto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nomeProduto,
          insumos,
          custoTotal: insumos.reduce((a, x) => a + x.subtotal, 0)
        })
      });

      let data = null;
      const text = await resp.text();
      if (text) { try { data = JSON.parse(text); } catch (_) { } }

      if (resp.status === 409) {
        showToast({
          title: 'Já existe um produto com este nome.',
          description: 'Escolha outro nome para continuar.',
          variant: 'error'
        });
        return;
      }

      if (resp.ok && ((data && data.success === true) || !data)) {
        showToast({ title: 'Produto criado com sucesso!', variant: 'success' });
        selecionados.clear();
        renderSelecionados();
        nomeProdutoEl.value = '';
      } else {
        const msg = (data && (data.error || data.message)) || `HTTP ${resp.status}`;
        showToast({ title: 'Falha ao criar produto', description: msg, variant: 'error' });
        console.error('Resposta do servidor:', data || text);
      }
    } catch (e) {
      console.error(e);
      showToast({ title: 'Erro de rede ao criar produto.', variant: 'error' });
    } finally {
      btnSalvarProduto.disabled = false;
      btnSalvarProduto.textContent = originalText;
    }
  });

  // ===== Inicialização =====
  carregarItensPaged(null);
});