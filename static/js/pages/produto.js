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

  // ===== NOVAS FUNÇÕES PARA CÁLCULO DE mL =====

  /**
   * Detecta se o produto é verniz pelo nome
   */
  function isVerniz(nomeProduto) {
    return nomeProduto.toLowerCase().includes('verniz') || nomeProduto.toLowerCase().includes('asa');
  }

  /**
   * Extrai litragem do nome do produto (padrão: 18L se não encontrar)
   */
  function extrairLitrosDoNome(nomeProduto) {
    const padroes = [
      /\b(\d+[,.]?\d*)(?<!-)\bL\b/i,              // "15L", mas não "952-L"
      /\b(\d+[,.]?\d*)Lt\b/i,                     // "15Lt"
      /\b(\d+[,.]?\d*)Litros?\b/i                 // "15Litros"
    ];

    for (let padrao of padroes) {
      const match = nomeProduto.match(padrao);
      if (match) {
        let litros = match[1].replace(',', '.');
        return parseFloat(litros);
      }
    }

    // Fallback: busca qualquer número no nome
    // const fallback = nomeProduto.match(/(\d+[,.]?\d*)/);
    // if (fallback) {
    //   let litros = fallback[1].replace(',', '.');
    //   return parseFloat(litros);
    // }

    // Padrão final: se é verniz mas não tem número, usa 18L
    return isVerniz(nomeProduto) ? 18 : null;
  }

  /**
   * Calcula preço por mL para verniz
   */
  function calcularPrecoPorML(nomeProduto, valorUnitario) {
    if (!isVerniz(nomeProduto)) return null;

    const litros = extrairLitrosDoNome(nomeProduto);
    if (!litros) return null;

    const precoPorML = valorUnitario / (litros * 1000);
    return {
      litros,
      precoPorML,
      isVerniz: true
    };
  }

  /**
   * Formata informação de mL para exibição
   */
  function formatarInfoML(infoML) {
    if (!infoML) return '';
    return `(R$ ${infoML.precoPorML.toFixed(4)}/mL - ${infoML.litros}L)`;
  }

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

  // function showToast({ title, description = '', variant = 'error', timeout = 4000 }) {
  //   const cont = ensureToastContainer();
  //   const el = document.createElement('div');
  //   el.className = `nf-toast ${variant === 'error' ? 'nf-toast--error' : 'nf-toast--success'}`;
  //   el.innerHTML = `
  //     <div class="nf-toast__row">
  //       <div>
  //         <div class="nf-toast__title">${title}</div>
  //         ${description ? `<div class="nf-toast__desc">${description}</div>` : ''}
  //       </div>
  //       <button class="nf-toast__close" aria-label="Fechar">&times;</button>
  //     </div>`;
  //   el.querySelector('.nf-toast__close').addEventListener('click', () => el.remove());
  //   cont.appendChild(el);
  //   if (timeout > 0) setTimeout(() => el.remove(), timeout);
  // }
function showToast({ title, description = '', variant = 'info', duration = 4000 }) {
  const container = document.getElementById('toast-container');
  if (!container) {
    console.error('Toast container não encontrado!');
    return;
  }

  // Cores baseadas na variante
  const variantStyles = {
    success: 'bg-green-500 text-white border-green-600 rounded-[40px]',
    error: 'bg-red-500 text-white border-red-600 rounded-[40px]',
    info: 'bg-blue-500 text-white border-blue-600 rounded-[40px] opacity-30',
    warning: 'bg-yellow-500 text-white border-yellow-600 rounded-[40px]'
  };

  const style = variantStyles[variant] || variantStyles.info;

  // Criar elemento do toast
  const toastId = 'toast-' + Date.now();
  const toast = document.createElement('div');
  toast.id = toastId;
  toast.className = `${style} rounded-lg shadow-lg p-4 min-w-[300px] max-w-md border transform transition-all duration-300 ease-in-out translate-x-32 opacity-0`;
  
  toast.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="flex-1">
        <div class="font-semibold">${title}</div>
        ${description ? `<div class="text-sm mt-1 opacity-90">${description}</div>` : ''}
      </div>
      <button onclick="removeToast('${toastId}')" class="ml-4 text-white hover:text-gray-200 text-lg font-bold">
        ×
      </button>
    </div>
  `;

  // Adicionar ao container
  container.appendChild(toast);

  // Animar entrada (vem da direita)
  setTimeout(() => {
    toast.classList.remove('translate-x-32', 'opacity-0');
    toast.classList.add('translate-x-0', 'opacity-100');
  }, 10);

  // Auto-remover
  setTimeout(() => {
    removeToast(toastId);
  }, duration);
}

function removeToast(toastId) {
  const toast = document.getElementById(toastId);
  if (toast) {
    toast.classList.add('translate-x-32', 'opacity-0');
    setTimeout(() => {
      if (toast.parentElement) {
        toast.remove();
      }
    }, 300);
  }
}
 

  // Abertura do Modal de Matéria-Prima
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

      // Verifica se é verniz para mostrar info adicional
      const infoML = calcularPrecoPorML(it.nome, it.valor_unitario);
      const infoText = infoML ? formatarInfoML(infoML) : '';

      div.innerHTML = `
        <div class="insumo-info">
          <p>${it.nome}</p>
          <p>
            ${it.codigo ? `Cód: ${it.codigo} · ` : ''}${it.unidade || ''} · ${fmt(it.valor_unitario)}
            ${infoText ? `<br><small style="color: #666;">${infoText}</small>` : ''}
          </p>
        </div>
        <div class="insumo-actions">
          <button data-add="${it.id}" type="button">Adicionar</button>
        </div>
      `;
      div.querySelector('[data-add]').addEventListener('click', () => {
        if (!selecionados.has(it.id)) {
          const infoML = calcularPrecoPorML(it.nome, it.valor_unitario);

          selecionados.set(it.id, {
            id: it.id,
            codigo: it.codigo,
            nome: it.nome,
            unidade: it.unidade,
            valor_unitario: Number(it.valor_unitario || 0),
            quantidade: 1,
            isVerniz: infoML ? true : false,
            litros: infoML ? infoML.litros : null,
            precoPorML: infoML ? infoML.precoPorML : null,
            fornecedor: it.fornecedor ?? ''
            

          });
          renderSelecionados();
          console.log('isVerniz:', item.isVerniz);
          console.log('precoPorML:', item.precoPorML);
          console.log('quantidade:', novaQuantidade);
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
    // let total = 0;
    // selecionados.forEach(ins => {
    //   total += parseNumero(ins.valor_unitario) * parseNumero(ins.quantidade);
    // });
    // totalValorEl.textContent = fmt(total);
    // return total;
    let total = 0;
    selecionados.forEach(ins => {
      const subtotal = ins.isVerniz
        ? parseNumero(ins.precoPorML) * parseNumero(ins.quantidade)
        : parseNumero(ins.valor_unitario) * parseNumero(ins.quantidade);
      total += subtotal;
    });
    totalValorEl.textContent = fmt(total);
    return total;
  }

  function renderSelecionados() {
    selecionadosTableBody.innerHTML = '';
    selecionados.forEach(ins => {
      // const subtotal = parseNumero(ins.valor_unitario) * parseNumero(ins.quantidade);
      const subtotal = ins.isVerniz
        ? parseNumero(ins.precoPorML) * parseNumero(ins.quantidade)
        : parseNumero(ins.valor_unitario) * parseNumero(ins.quantidade);
      const isVernizItem = ins.isVerniz;

      const tr = document.createElement('tr');
      tr.setAttribute('data-id', ins.id);
      tr.setAttribute('data-vu', String(ins.valor_unitario));

      // HTML diferente para verniz (com input de mL)
      if (isVernizItem) {
        tr.innerHTML = `
        <td colspan="6" class="card-line">
          <div class="card">
            <div class="card-content">
              <p>Código</p>
              <p>Nome</p>
              <p>Unidade</p>
              <p>Valor unitário</p>
              <p>Quantidade (mL)</p>
              <p>Subtotal</p>
              <p>${ins.codigo}</p>
              <p>${ins.nome}</p>
              <p>${ins.unidade || ''}</p>
              <p>${fmt(ins.valor_unitario)}<br><small>${ins.litros}L • R$ ${ins.precoPorML.toFixed(4)}/mL</small></p>
              <input type="number" inputmode="decimal" lang="pt-BR" step="1" min="0"
                    value="${ins.quantidade ?? 100}" data-id="${ins.id}"
                    class="quantidade-input" placeholder="mL">
              <p data-subtotal>${fmt(subtotal)}</p>
            </div>
          </div>
          <button class="btn btn-primary" data-rm="${ins.id}" type="button">
            <img src="../static/image/icon-close-calc.svg" alt="">
          </button>
        </td>
        `;
      } else {
        // HTML normal para outros produtos
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
              <p>${ins.nome}</p>
              <p>${ins.unidade || ''}</p>
              <p>${fmt(ins.valor_unitario)}</p>
              <input type="number" inputmode="decimal" lang="pt-BR" step="0.0001" min="0"
                    value="${ins.quantidade ?? 1}" data-id="${ins.id}"
                    class="quantidade-input">
              <p data-subtotal>${fmt(subtotal)}</p>
            </div>
          </div>
          <button class="btn btn-primary" data-rm="${ins.id}" type="button">
            <img src="../static/image/icon-close-calc.svg" alt="">
          </button>
        </td>
        `;
      }

      selecionadosTableBody.appendChild(tr);
      const input = tr.querySelector('.quantidade-input');
      const subtotalEl = tr.querySelector('[data-subtotal]');

      input.addEventListener('input', (e) => {
        const id = e.target.dataset.id;
        const novaQuantidade = parseFloat(e.target.value.replace(",", ".")) || 0;

        if (selecionados.has(id)) {
          const item = selecionados.get(id);
          item.quantidade = novaQuantidade;

          // Recalcula subtotal corretamente
          const novoSubtotal = item.isVerniz
            ? item.precoPorML * novaQuantidade
            : parseNumero(item.valor_unitario) * novaQuantidade;

          // Atualiza subtotal na interface
          if (subtotalEl) subtotalEl.textContent = fmt(novoSubtotal);

          // Atualiza total geral
          recalcTotal();
        }
      });
    });
  }

  // ===== Delegação na tabela selecionados =====
  selecionadosTableBody.addEventListener('input', e => {
    const input = e.target.closest('input[type="number"]');
    if (!input) return;
    const id = input.getAttribute('data-id');
    const row = input.closest('tr');
    const vUnit = parseNumero(row.getAttribute('data-vu'));
    const q = parseNumero(input.value);

    if (selecionados.has(id)) {
      selecionados.get(id).quantidade = q;
    }

    row.querySelector('[data-subtotal]').textContent =fmt(novoSubtotal);
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
      url.searchParams.set('limit', PER_PAGE * 3);

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
      pageNum = 1;
      pageCursor = null;
      nextCursor = null;
      cursorStack = [];
      carregarItensBusca(term);
    } else {
      isSearchMode = false;
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
      pageCursor = cursorStack.pop() || null;
      pageNum = Math.max(1, pageNum - 1);
      carregarItensPaged(pageCursor);
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
      if (isSearchMode || !nextCursor) return;
      cursorStack.push(pageCursor);
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
      const preco = ins.isVerniz ? ins.precoPorML: Number(ins.valor_unitario || 0);
      const valor_unitario = preco;
      const subtotal = preco * quantidade;
      insumos.push({
        id_item: ins.id,
        nome: ins.nome,
        unidade: ins.unidade,
        valor_unitario,
        quantidade,
        subtotal,
        fornecedor: ins.fornecedor ?? '' // 👈 ADICIONADO
      });
    });

    btnSalvarProduto.disabled = true;
    const originalText = btnSalvarProduto.textContent;
    btnSalvarProduto.textContent = 'SALVANDO...';

    try {
      console.log('Insumos enviados:', insumos);
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