// /static/js/pages/index.js
document.addEventListener('DOMContentLoaded', function () {
  // --- ELEMENTOS DA TELA ---
  const uploadForm = document.getElementById('uploadForm');
  const xmlFileInput = document.getElementById('xmlFile');
  const loadingIndicator = document.getElementById('loading');

  const itensContainer = document.getElementById('itensContainer');
  const itensTableBody = document.getElementById('itensTable').querySelector('tbody');

  const btnCriarProduto = document.getElementById('btnCriarProduto');
  const btnEnviarItens = document.getElementById('btnEnviarItens');   // botão de enviar (tudo-ou-nada)
  const btnFecharNota = document.getElementById('btnFecharNota');     // botão "Fechar Nota fiscal"

  // (se você tiver a seção de produtos)
  const produtosCriados = document.getElementById('produtosCriados');

  // --- MODAL DE CONFLITO (se já existir no seu HTML) ---
  const modalDuplicata = document.getElementById('modalDuplicata');
  const modalLista = document.getElementById('modalLista');
  const modalFechar = document.getElementById('modalFechar');

  // --- MODAL NAMESPACED para "Fechar Nota fiscal" ---
  const nfCloseModal = document.getElementById('nfCloseModal');
  const nfCloseCancel = document.getElementById('nfCloseCancel');
  const nfCloseConfirm = document.getElementById('nfCloseConfirm');

  // --- ESTADO / STORAGE ---
  const LS_KEY = 'nfItensProcessados';
  let itensProcessados = [];

  // --- HELPERS VISUAIS ---
  const show = el => el && el.classList.remove('hidden');
  const hide = el => el && el.classList.add('hidden');

  const emptyState = document.getElementById("emptyState");
  const itensContainers = document.getElementById("itensContainer");
  const itensTable = document.getElementById("itensTable");

  function exibirItens(itens) {
    itensTableBody.innerHTML = '';
    itens.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.codigo}</td>
        <td>${item.nome}</td>
        <td>${item.unidade}</td>
        <td>${item.quantidade}</td>
        <td>R$ ${Number(item.valor_unitario || 0).toFixed(2)}</td>
      `;
      itensTableBody.appendChild(tr);
    });
  }

  function atualizarUIAposCarregar(itens) {
    if (Array.isArray(itens) && itens.length) {
      exibirItens(itens);
      show(itensContainer);
      show(btnCriarProduto);
      show(btnEnviarItens);
      show(btnFecharNota);
    } else {
      itensTableBody.innerHTML = '';
      hide(itensContainer);
      hide(btnCriarProduto);
      hide(btnEnviarItens);
      hide(btnFecharNota);
    }
  }

  // --- HELPERS STORAGE ---
  function salvarNoLocalStorage(itens) {
    localStorage.setItem(LS_KEY, JSON.stringify(itens)); // substitui o anterior
  }
  function limparLocalStorage() {
    localStorage.removeItem(LS_KEY);
  }

  // --- MODAL DUPLICATA (existente) ---
  function abrirModalDuplicata(conflicts) {
    if (!modalDuplicata) {
      alert('Conflitos encontrados (item já cadastrado). Adicione o modalDuplicata no HTML para ver a lista.');
      return;
    }
    modalLista.innerHTML = '';
    conflicts.forEach(({ item }) => {
      const li = document.createElement('li');
      li.textContent =
        `${item.nome} — ${item.unidade} — R$ ${Number(item.valor_unitario).toFixed(2)} — ${item.data_emissao}` +
        (item.codigo ? ` — cód: ${item.codigo}` : '');
      modalLista.appendChild(li);
    });
    show(modalDuplicata);
  }
  if (modalFechar) modalFechar.addEventListener('click', () => hide(modalDuplicata));

  // --- MODAL "Fechar Nota fiscal" (namespaced) ---
  function openNfCloseModal() {
    if (!nfCloseModal) return;
    nfCloseModal.classList.remove('hidden');
    nfCloseModal.setAttribute('aria-hidden', 'false');
  }
  function closeNfCloseModal() {
    if (!nfCloseModal) return;
    nfCloseModal.classList.add('hidden');
    nfCloseModal.setAttribute('aria-hidden', 'true');
  }
  if (btnFecharNota) {
    btnFecharNota.addEventListener('click', openNfCloseModal);
  }
  if (nfCloseCancel) nfCloseCancel.addEventListener('click', closeNfCloseModal);
  if (nfCloseConfirm) {
    nfCloseConfirm.addEventListener('click', function () {
      itensProcessados = [];
      limparLocalStorage();
      atualizarUIAposCarregar([]);
      closeNfCloseModal();
    });
  }
  if (nfCloseModal) {
    nfCloseModal.addEventListener('click', e => {
      if (e.target === nfCloseModal) closeNfCloseModal();
    });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && nfCloseModal && !nfCloseModal.classList.contains('hidden')) {
      closeNfCloseModal();
    }
  });

  // --- RESTAURA AO VOLTAR PARA A TELA ---
  try {
    const salvo = localStorage.getItem(LS_KEY);
    if (salvo) {
      itensProcessados = JSON.parse(salvo);
      atualizarUIAposCarregar(itensProcessados);
    }
  } catch (e) {
    console.warn('Falha ao ler localStorage:', e);
  }

  // --- UPLOAD DO XML ---
  // uploadForm.addEventListener('submit', function (e) {
  //   e.preventDefault();
  //   if (!xmlFileInput.files.length) {
  //     alert('Por favor, selecione um arquivo XML');
  //     return;
  //   }

  //   show(loadingIndicator);

  //   const formData = new FormData();
  //   formData.append('xmlFile', xmlFileInput.files[0]);

  //   fetch('/upload-xml', { method: 'POST', body: formData })
  //     .then(r => r.json())
  //     .then(data => {
  //       hide(loadingIndicator);

  //       if (data.error) {
  //         alert('Erro ao processar XML: ' + data.error);
  //         return;
  //       }

  //       // backend pode retornar lista pura OU {itens:[...]}
  //       const itens = Array.isArray(data) ? data : (data.itens || []);

  //       // salva (substitui) no localStorage
  //       itensProcessados = itens;
  //       salvarNoLocalStorage(itensProcessados);

  //       // atualiza UI
  //       atualizarUIAposCarregar(itensProcessados);
  //     })
  //     .catch(err => {
  //       hide(loadingIndicator);
  //       console.error(err);
  //       alert('Ocorreu um erro ao processar o arquivo');
  //     });
  // });
  xmlFileInput.addEventListener("change", function () {
    if (!xmlFileInput.files.length) {
      alert("Por favor, selecione um arquivo XML");
      return;
    }

    show(loadingIndicator);

    const formData = new FormData();
    formData.append("xmlFile", xmlFileInput.files[0]);

    fetch("/upload-xml", { method: "POST", body: formData })
      .then((r) => r.json())
      .then((data) => {
        hide(loadingIndicator);

        if (data.error) {
          alert("Erro ao processar XML: " + data.error);
          return;
        }

        // backend pode retornar lista pura OU {itens:[...]}
        const itens = Array.isArray(data) ? data : (data.itens || []);

        itensProcessados = itens;
        salvarNoLocalStorage(itensProcessados);

        atualizarUIAposCarregar(itensProcessados);
      })
      .catch((err) => {
        hide(loadingIndicator);
        console.error(err);
        alert("Ocorreu um erro ao processar o arquivo");
      });
  });

  // --- IR PARA /produto ---
  btnCriarProduto.addEventListener('click', function () {
    sessionStorage.setItem('itensProcessados', JSON.stringify(itensProcessados));
    window.location.href = '/produto';
  });

  // --- ENVIAR TUDO-OU-NADA PARA /criar-itens ---
  if (btnEnviarItens) {
    btnEnviarItens.addEventListener('click', async function () {
      if (!itensProcessados.length) {
        alert('Nenhum item para enviar.');
        return;
      }

      const payload = {
        itens: itensProcessados.map(it => ({
          codigo: it.codigo ?? null,
          nome: it.nome,
          unidade: it.unidade,
          quantidade: it.quantidade,
          valor_unitario: it.valor_unitario,
          data_emissao: it.data_emissao ?? '' // já extraído no backend
        }))
      };

      btnEnviarItens.disabled = true;
      const originalText = btnEnviarItens.textContent;
      btnEnviarItens.textContent = 'Validando e enviando...';

      try {
        const resp = await fetch('/criar-itens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await resp.json();

        if (resp.status === 409 && data.conflicts) {
          // encontrou duplicatas => mostra seu modal de conflito (se existir)
          abrirModalDuplicata(data.conflicts);
        } else if (resp.ok && data.success) {
          alert(`Itens enviados com sucesso: ${data.created}`);
        } else {
          alert('Falha no envio: ' + (data.error || 'erro desconhecido'));
          console.error(data);
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

  // --- opcional: carregarProdutosExistentes(); ---



});
