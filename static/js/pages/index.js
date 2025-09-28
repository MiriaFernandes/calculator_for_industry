// /static/js/pages/index.js
document.addEventListener('DOMContentLoaded', function () {
  // ==============================
  // ELEMENTOS DA TELA
  // ==============================
  const uploadForm = document.getElementById('uploadForm');
  const xmlFileInput = document.getElementById('xmlFile');
  const loadingIndicator = document.getElementById('loading');

  const itensContainer = document.getElementById('itensContainer');
  const itensTable = document.getElementById('itensTable');
  const itensTableBody = itensTable ? itensTable.querySelector('tbody') : null;

  const btnCriarProduto = document.getElementById('btnCriarProduto'); // pode não existir (HTML atual está comentado)
  const btnEnviarItens = document.getElementById('btnEnviarItens');
  const btnFecharNota = document.getElementById('btnFecharNota');

  const produtosCriados = document.getElementById('produtosCriados'); // opcional

  // Modais
  const modalDuplicata = document.getElementById('modalDuplicata');
  const modalLista = document.getElementById('modalLista');
  const modalFechar = document.getElementById('modalFechar');

  const nfCloseModal = document.getElementById('nfCloseModal');
  const nfCloseCancel = document.getElementById('nfCloseCancel');
  const nfCloseConfirm = document.getElementById('nfCloseConfirm');

  // Empty state (pode estar comentado no HTML)
  const emptyState = document.getElementById('emptyState');

  // ==============================
  // ESTADO / STORAGE
  // ==============================
  // Mantém compatibilidade com a chave antiga do 2º código (nfItensProcessados)
  const LS_KEY_NEW = 'itensProcessados';
  const LS_KEY_OLD = 'nfItensProcessados';
  let itensProcessados = [];

  // ==============================
  // HELPERS VISUAIS / GERAIS
  // ==============================
  const show = (el) => el && el.classList.remove('hidden');
  const hide = (el) => el && el.classList.add('hidden');

  function salvarNoLocalStorage(itens) {
    try {
      localStorage.setItem(LS_KEY_NEW, JSON.stringify(itens));
    } catch (e) {
      console.warn('Falha ao salvar no localStorage:', e);
    }
  }

  function carregarDoLocalStorage() {
    try {
      // Prioriza a nova chave, mas aceita a antiga se existir
      const rawNew = localStorage.getItem(LS_KEY_NEW);
      if (rawNew) return JSON.parse(rawNew);

      const rawOld = localStorage.getItem(LS_KEY_OLD);
      if (rawOld) return JSON.parse(rawOld);

      return null;
    } catch (e) {
      console.warn('Falha ao ler localStorage:', e);
      return null;
    }
  }

  function limparLocalStorage() {
    try {
      localStorage.removeItem(LS_KEY_NEW);
      localStorage.removeItem(LS_KEY_OLD);
    } catch (e) {
      console.warn('Falha ao limpar localStorage:', e);
    }
  }

  // Atualiza card branco (logo x tabela) — compatível com seu script inline
  function atualizarEstadoCard() {
    if (!itensTableBody) return;
    const temLinhas = itensTableBody.children.length > 0;
    if (emptyState) {
      if (temLinhas) {
        emptyState.classList.add('hidden');
      } else {
        emptyState.classList.remove('hidden');
      }
    }
    if (temLinhas) {
      show(itensContainer);
    } else {
      hide(itensContainer);
    }
  }
  // Disponibiliza globalmente também (mantém compatibilidade com inline)
  window.atualizarEstadoCard = atualizarEstadoCard;

  // ==============================
  // DROPDOWN DE CATEGORIA (OPCIONAL)
  // Mantido do 1º código. Só será usado se existir coluna de categoria no HTML.
  // ==============================
  function wireCategoriaDropdown(root) {
    if (!root) return;
    const btn = root.querySelector('.categoria-btn');
    const menu = root.querySelector('.categoria-menu');
    const input = root.querySelector('.categoria-value');
    const label = root.querySelector('.categoria-label');
    if (!btn || !menu || !input || !label) return;

    function openMenu() {
      menu.classList.remove('pointer-events-none');
      requestAnimationFrame(function () {
        menu.classList.add('opacity-100', 'scale-100');
        menu.classList.remove('opacity-0', 'scale-95');
      });
      const lis = menu.querySelectorAll('li');
      lis.forEach((li, i) => {
        li.style.transition = 'transform 180ms ease-out, opacity 180ms ease-out';
        li.style.transform = 'translateY(4px)';
        li.style.opacity = '0';
        requestAnimationFrame(() => {
          setTimeout(() => {
            li.style.transform = 'translateY(0)';
            li.style.opacity = '1';
          }, i * 20);
        });
      });
    }
    function closeMenu() {
      menu.classList.add('opacity-0', 'scale-95');
      menu.classList.remove('opacity-100', 'scale-100');
      const onEnd = (ev) => {
        if (ev.propertyName === 'opacity') {
          menu.classList.add('pointer-events-none');
          menu.removeEventListener('transitionend', onEnd);
        }
      };
      menu.addEventListener('transitionend', onEnd);
    }
    menu.classList.add('opacity-0', 'scale-95', 'pointer-events-none', 'transition', 'ease-out', 'duration-200', 'transform-gpu');

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu.classList.contains('pointer-events-none')) openMenu(); else closeMenu();
    });
    menu.querySelectorAll('[data-value]').forEach(opt => {
      opt.addEventListener('click', function () {
        const val = opt.getAttribute('data-value') || '';
        input.value = val;
        label.textContent = val ? val : 'Selecionar';
        btn.classList.add('scale-95');
        setTimeout(() => btn.classList.remove('scale-95'), 120);
        closeMenu();
      });
    });
    document.addEventListener('click', function (ev) {
      if (!root.contains(ev.target)) closeMenu();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closeMenu();
    });
  }

  // ==============================
  // RENDER TABELA (aderente ao seu HTML)
  // Se houver coluna de categoria no HTML, renderiza também o dropdown.
  // Detectamos pela presença de um TH com data-col="categoria" OU texto "Categoria".
  // ==============================
  function tabelaTemCategoria() {
    if (!itensTable) return false;
    const ths = Array.from(itensTable.querySelectorAll('thead th'));
    return ths.some(th => th.getAttribute('data-col') === 'categoria' || /categoria/i.test(th.textContent || ''));
  }

  const usarCategoria = tabelaTemCategoria();

  function exibirItens(itens) {
    if (!itensTableBody) return;
    itensTableBody.innerHTML = '';

    itens.forEach((item, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'animate-slideUp';
      tr.style.animationDelay = (idx * 60) + 'ms';

      // Colunas do seu HTML
      const tds = [
        `<td class="px-4 py-2 ">${item.codigo ?? ''}</td>`,
        `<td class="px-4 py-2">${item.data_emissao ?? ''}</td>`,
        `<td class="px-4 py-2">${item.nome ?? ''}</td>`,
        `<td class="px-4 py-2">${item.fornecedor ?? ''}</td>`,
        `<td class="px-4 py-2">${item.unidade ?? ''}</td>`,
        `<td class="px-4 py-2">R$ ${Number(item.valor_unitario || 0).toFixed(2)}</td>`
      ];

      // Se existir coluna de categoria no HTML, renderiza dropdown
      if (usarCategoria) {
        const categoriaCell = `
          <td class="px-4 py-2">
            <div class="relative inline-block text-left w-40">
              <button type="button" class="categoria-btn w-full inline-flex justify-between items-center rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm hover:shadow-elev transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-600" aria-haspopup="menu" aria-expanded="false">
                <span class="categoria-label text-gray-700">Selecionar</span>
                <svg class="h-4 w-4 opacity-70" viewBox="0 0 20 20" fill="currentColor"><path d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 011.08 1.04l-4.25 4.25a.75.75 0 01-1.06 0L5.21 8.27a.75.75 0 01.02-1.06z"/></svg>
              </button>
              <input type="hidden" class="categoria-value" value="">
              <div class="categoria-menu origin-top-right absolute right-0 z-[9999] mt-1 w-40 rounded-2xl bg-white shadow-lg ring-1 ring-black/5 opacity-0 scale-95 pointer-events-none transition ease-out duration-200 transform-gpu will-change-[transform,opacity]">
                <ul class="py-2 text-sm text-gray-700">
                  <li><button type="button" data-value="" class="w-full text-left px-3 py-2 hover:bg-gray-50">— sem categoria —</button></li>
                  <li><button type="button" data-value="parafuso" class="w-full text-left px-3 py-2 hover:bg-gray-50">parafuso</button></li>
                  <li><button type="button" data-value="verniz" class="w-full text-left px-3 py-2 hover:bg-gray-50">verniz</button></li>
                  <li><button type="button" data-value="escova" class="w-full text-left px-3 py-2 hover:bg-gray-50">escova</button></li>
                </ul>
              </div>
            </div>
          </td>
        `;
        // Insere categoria como última coluna
        tds.push(categoriaCell);
        console.log(dados);
      }

      tr.innerHTML = tds.join('');
      itensTableBody.appendChild(tr);

      // Liga o dropdown se estiver em uso
      if (usarCategoria) {
        wireCategoriaDropdown(tr.querySelector('.relative'));
      }
    });

    atualizarEstadoCard();
  }

  function atualizarUIAposCarregar(itens) {
    if (Array.isArray(itens) && itens.length) {
      exibirItens(itens);
      show(btnEnviarItens);
      show(btnFecharNota);
    } else {
      if (itensTableBody) itensTableBody.innerHTML = '';
      hide(btnEnviarItens);
      hide(btnFecharNota);
      atualizarEstadoCard();
    }
  }

  // ==============================
  // MODAL DUPLICATA
  // ==============================
  function abrirModalDuplicata(conflicts) {
    if (!modalDuplicata || !modalLista) {
      alert('Conflitos encontrados (item já cadastrado).');
      return;
    }
    modalLista.innerHTML = '';
    conflicts.forEach(({ item }) => {
      const li = document.createElement('li');
      li.textContent = `${item.nome} — ${item.unidade} — R$ ${Number(item.valor_unitario).toFixed(2)} — ${item.data_emissao}` + (item.codigo ? ` — cód: ${item.codigo}` : '');
      modalLista.appendChild(li);
    });
    show(modalDuplicata);
  }
  if (modalFechar) modalFechar.addEventListener('click', () => hide(modalDuplicata));

  // ==============================
  // MODAL FECHAR NOTA
  // (com clique fora + ESC e animação quando possível)
  // ==============================
  function getNfModalContent() {
    if (!nfCloseModal) return null;
    // tenta achar um container interno "conteúdo" para animar
    return nfCloseModal.querySelector('.nf-modal__content') || nfCloseModal.querySelector('.bg-white');
  }

  function openNfCloseModal() {
    if (!nfCloseModal) return;
    show(nfCloseModal);
    nfCloseModal.setAttribute('aria-hidden', 'false');
    const content = getNfModalContent();
    if (content) {
      content.classList.remove('animate-slideUp');
      // reflow
      void content.offsetWidth;
      content.classList.add('animate-slideUp');
    }
  }
  function closeNfCloseModal() {
    if (!nfCloseModal) return;
    hide(nfCloseModal);
    nfCloseModal.setAttribute('aria-hidden', 'true');
  }
  if (btnFecharNota) btnFecharNota.addEventListener('click', openNfCloseModal);
  if (nfCloseCancel) nfCloseCancel.addEventListener('click', closeNfCloseModal);
  if (nfCloseConfirm) {
    nfCloseConfirm.addEventListener('click', function () {
      itensProcessados = [];
      salvarNoLocalStorage(itensProcessados); // mantém coerência do estado salvo
      atualizarUIAposCarregar(itensProcessados);
      closeNfCloseModal();
    });
  }
  if (nfCloseModal) {
    nfCloseModal.addEventListener('click', (e) => {
      if (e.target === nfCloseModal) closeNfCloseModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nfCloseModal && !nfCloseModal.classList.contains('hidden')) {
      closeNfCloseModal();
    }
  });

  // ==============================
  // UPLOAD XML
  // ==============================
  // Dispara o submit automaticamente ao selecionar um arquivo
  if (xmlFileInput) {
    xmlFileInput.addEventListener('change', function () {
      if (xmlFileInput.files.length) {
        uploadForm.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    });
  }
  if (uploadForm) {
    uploadForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!xmlFileInput || !xmlFileInput.files || !xmlFileInput.files.length) {
        alert('Selecione um arquivo XML.');
        return;
      }

      show(loadingIndicator);

      const formData = new FormData();
      formData.append('xmlFile', xmlFileInput.files[0]);

      fetch('/upload-xml', { method: 'POST', body: formData })
        .then(r => r.json())
        .then(data => {
          hide(loadingIndicator);

          if (data && data.error) {
            alert('Erro ao processar XML: ' + data.error);
            return;
          }

          // backend pode retornar lista pura OU {itens:[...]}
          const itens = Array.isArray(data) ? data : (data && Array.isArray(data.itens) ? data.itens : []);
          itensProcessados = itens;
          salvarNoLocalStorage(itensProcessados);
          atualizarUIAposCarregar(itensProcessados);
        })
        .catch(err => {
          hide(loadingIndicator);
          console.error(err);
          alert('Ocorreu um erro ao processar o arquivo.');
        });
    });
  }

  // ==============================
  // IR PARA /produto (se existir botão)
  // ==============================
  if (btnCriarProduto) {
    btnCriarProduto.addEventListener('click', function () {
      sessionStorage.setItem('itensProcessados', JSON.stringify(itensProcessados));
      window.location.href = '/produto';
    });
  }

  // ==============================
  // ENVIAR ITENS PARA /criar-itens
  // Integra a lógica do 1º (categorias por linha) + 2º (tratamento de erro)
  // ==============================
  if (btnEnviarItens) {
    btnEnviarItens.addEventListener('click', async function () {
      if (!itensProcessados.length) {
        alert('Nenhum item para enviar.');
        return;
      }

      let itensParaEnviar;
      if (usarCategoria) {
        const categoriaInputs = Array.from(document.querySelectorAll('#itensTable tbody .categoria-value'));
        itensParaEnviar = itensProcessados.map((it, idx) => ({
          codigo: it.codigo ?? null,
          nome: it.nome,
          unidade: it.unidade,
          quantidade: it.quantidade,
          valor_unitario: it.valor_unitario,
          data_emissao: it.data_emissao ?? '',
            fornecedor: it.fornecedor ?? '', // 👈 ADICIONADO
          categoria: (categoriaInputs[idx] && categoriaInputs[idx].value) ? categoriaInputs[idx].value : null
        }));
      } else {
        itensParaEnviar = itensProcessados.map(it => ({
          codigo: it.codigo ?? null,
          nome: it.nome,
          unidade: it.unidade,
          quantidade: it.quantidade,
          valor_unitario: it.valor_unitario,
          data_emissao: it.data_emissao ?? '',
          fornecedor: it.fornecedor ?? '', // 👈 ADICIONADO
        }));
      }

      const payload = { itens: itensParaEnviar };

      const originalText = btnEnviarItens.textContent;
      btnEnviarItens.textContent = 'VALIDANDO E ENVIANDO...';
      btnEnviarItens.disabled = true;

      try {
        const resp = await fetch('/criar-itens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await resp.json();

        if (resp.status === 409 && data && data.conflicts) {
          abrirModalDuplicata(data.conflicts);
        } else if (resp.ok && data && data.success) {
          alert(`Itens criados: ${data.created}`);
          limparLocalStorage();
          itensProcessados = [];
          atualizarUIAposCarregar(itensProcessados);
        } else {
          console.error(data);
          alert('Falha no envio: ' + ((data && data.error) || 'erro desconhecido'));
        }
      } catch (err) {
        console.error(err);
        alert('Erro de rede ao enviar itens.');
      } finally {
        btnEnviarItens.disabled = false;
        btnEnviarItens.textContent = originalText;
      }
    });
  }

  // ==============================
  // INIT — Carrega cache e prepara UI
  // ==============================
  const cache = carregarDoLocalStorage();
  if (Array.isArray(cache) && cache.length) {
    itensProcessados = cache;
    atualizarUIAposCarregar(itensProcessados);
  } else {
    atualizarUIAposCarregar([]);
  }
});
