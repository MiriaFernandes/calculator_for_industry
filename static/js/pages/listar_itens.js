
// /static/js/pages/listar_itens.js (Bootstrap-free modals to avoid freezes)
document.addEventListener('DOMContentLoaded', () => {
  const tbody = document.querySelector('#itensTable tbody');
  const searchInput = document.getElementById('searchInput');
  const clearSearch = document.getElementById('clearSearch');
  const prevBtn = document.getElementById('prevPage');
  const nextBtn = document.getElementById('nextPage');
  const pageInfo = document.getElementById('pageInfo');
  const statusBar = document.getElementById('statusBar');
  // Bootstrap Modals
  const saveModalEl = document.getElementById('saveModal');
  const delModalEl  = document.getElementById('delModal');
  const saveModal = saveModalEl ? new bootstrap.Modal(saveModalEl) : null;
  const delModal  = delModalEl ? new bootstrap.Modal(delModalEl) : null;
  const saveConfirm = document.getElementById('saveConfirm');
  const saveCancel  = document.getElementById('saveCancel');
  const delNameEl   = document.getElementById('delItemName');
  const delCancel   = document.getElementById('delCancel');
  const delConfirm  = document.getElementById('delConfirm');
  let pendingDelete = null; // { id, tr, name }
  let pendingSave   = null; // { id, tr, payload, inputs, btn }

  // Modal HTML (fixo no template)
  const delModal   = document.getElementById('delModal');
  const delNameEl  = document.getElementById('delItemName');
  const delCancel  = document.getElementById('delCancel');
  const delConfirm = document.getElementById('delConfirm');
  let pendingDelete = null; // { id, tr, name }
  const show = el => el && el.classList.remove('hidden');
  const hide = el => el && el.classList.add('hidden');


  // Custom modals
  const cmEdit = document.getElementById('cmEdit');
  const cmDelete = document.getElementById('cmDelete');
  const cmEditConfirm = document.getElementById('cmEditConfirm');
  const cmDeleteConfirm = document.getElementById('cmDeleteConfirm');

  function openModal(el) { el?.classList.add('open'); }
  function closeModal(el) { el?.classList.remove('open'); }
  document.querySelectorAll('.custom-modal-overlay [data-cm-action="close"]').forEach(btn => {
    btn.addEventListener('click', (e) => closeModal(e.target.closest('.custom-modal-overlay')));
  });
  [cmEdit, cmDelete].forEach(overlay => {
    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay);
    });
  });

  let cursor = null;
  let pageStack = [];
  let pendingAction = null;

  async function loadItens({ reset=false } = {}) {
    const q = (searchInput?.value || '').trim();
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (cursor && !q) params.set('cursor', cursor);
    params.set('limit', 20);

    statusBar && (statusBar.textContent = 'Carregando...');
    try {
      const res = await fetch(`/listar-itens?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Erro ao listar itens');

      renderRows(data.items || []);
      pageInfo && (pageInfo.textContent = (data.items?.length ? `Exibindo ${data.items.length} item(ns)` : 'Nenhum item encontrado'));

      if (q) {
        nextBtn && (nextBtn.disabled = true);
        prevBtn && (prevBtn.disabled = true);
        cursor = null;
      } else {
        nextBtn && (nextBtn.disabled = !data.next_cursor);
        if (reset) {
          pageStack = [];
          prevBtn && (prevBtn.disabled = true);
        } else {
          prevBtn && (prevBtn.disabled = pageStack.length === 0);
        }
        cursor = data.next_cursor || null;
      }
      statusBar && (statusBar.textContent = '');
    } catch (e) {
      statusBar && (statusBar.textContent = e.message);
      console.error(e);
    }
  }

  
  function renderRows(items) {
    tbody.innerHTML = '';
    items.forEach(it => {
      const tr = document.createElement('tr');
      tr.dataset.id = it.id;
      tr.innerHTML = `
        <td>${it.codigo ?? ''}</td>
        <td><input class="form-control form-control-sm" data-field="nome" value="${it.nome ?? ''}" disabled></td>
        <td><input class="form-control form-control-sm" data-field="unidade" value="${it.unidade ?? ''}" disabled></td>
        <td><input class="form-control form-control-sm" data-field="valor_unitario" inputmode="decimal" value="${it.valor_unitario ?? ''}" disabled></td>
        <td>${it.data_emissao ?? ''}</td>
        <td>
          <div class="d-grid gap-1">
            <button class="btn btn-sm btn-outline-danger" data-action="delete">Apagar</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Confirm actions with custom modals
  cmEditConfirm?.addEventListener('click', async () => {
    if (!pendingAction || pendingAction.type !== 'save') return;
    const { id, payload } = pendingAction;
    try {
      const res = await fetch(`/itens/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data?.error || 'Falha ao salvar');
      statusBar && (statusBar.textContent = 'Alterações salvas.');
      setTimeout(() => statusBar && (statusBar.textContent = ''), 2000);
    } catch (e) {
      statusBar && (statusBar.textContent = e.message);
    } finally {
      closeModal(cmEdit);
      pendingAction = null;
    }
  });

  cmDeleteConfirm?.addEventListener('click', async () => {
    if (!pendingAction || pendingAction.type !== 'delete') return;
    const { id, row } = pendingAction;
    try {
      const res = await fetch(`/itens/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data?.error || 'Falha ao apagar');
      row?.remove();
      statusBar && (statusBar.textContent = 'Item removido.');
      setTimeout(() => statusBar && (statusBar.textContent = ''), 2000);
    } catch (e) {
      statusBar && (statusBar.textContent = e.message);
    } finally {
      closeModal(cmDelete);
      pendingAction = null;
    }
  });

  // Table actions
  tbody?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;

    const tr = btn.closest('tr');
    const id = tr?.dataset?.id;
    if (!id) return;

    const action = btn.dataset.action;
    
    if (action === 'save') {
      const inputs = tr.querySelectorAll('input[data-field]');
      const payload = {};
      inputs.forEach(inp => {
        let v = inp.value;
        if (inp.dataset.field === 'valor_unitario') {
          v = parseFloat(String(v).replace('.', '').replace(',', '.'));
          if (!isFinite(v)) v = null;
        }
        payload[inp.dataset.field] = v;
      });
      pendingSave = { id, tr, payload, inputs, btn };
      if (saveModal) saveModal.show();
      return;
    }
    ;
      inputs.forEach(inp => {
        let v = inp.value;
        if (inp.dataset.field === 'valor_unitario') {
          v = parseFloat(String(v).replace('.', '').replace(',', '.'));
          if (!isFinite(v)) v = null;
        }
        payload[inp.dataset.field] = v;
      });
      pendingAction = { type: 'save', id, payload };
      openModal(cmEdit);
      return;
    }
    
  
    if (action === 'delete') {
      const nameInput = tr.querySelector('input[data-field="nome"]');
      const name = nameInput ? nameInput.value : ('#' + id);
      pendingDelete = { id, tr, name };
      if (delNameEl) delNameEl.textContent = name;
      if (delModal) delModal.show();
      return;
    }
    });


  // Pagination + search
  nextBtn?.addEventListener('click', () => {
    if (!nextBtn.disabled) {
      pageStack.push(cursor);
      loadItens();
    }
  });
  prevBtn?.addEventListener('click', () => {
    if (pageStack.length > 0) {
      cursor = pageStack.pop();
      cursor = null;
      loadItens({ reset: true });
    }
  });
  searchInput?.addEventListener('input', () => {
    clearTimeout(searchInput._t);
    searchInput._t = setTimeout(() => loadItens({ reset: true }), 350);
  });
  clearSearch?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    loadItens({ reset: true });
  });

  loadItens({ reset: true });
});
