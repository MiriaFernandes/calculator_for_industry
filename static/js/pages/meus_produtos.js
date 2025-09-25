document.addEventListener('DOMContentLoaded', function () {
    const searchInput = document.getElementById('search-input');
    const productGrid = document.getElementById('product-grid');

    // 1. Função para configurar os details (botão +)
    function setupDetailsListeners() {
        // Usar event delegation para evitar problemas
        document.addEventListener('click', function (e) {
            if (e.target.classList.contains('toggle-icon')) {
                e.preventDefault();
                e.stopPropagation();

                const details = e.target.closest('details');
                const isOpen = details.hasAttribute('open');

                // Fechar todos os outros details
                document.querySelectorAll('.product-card details[open]').forEach(otherDetails => {
                    if (otherDetails !== details) {
                        otherDetails.removeAttribute('open');
                        const otherIcon = otherDetails.querySelector('.toggle-icon');
                        if (otherIcon) otherIcon.textContent = '+';
                    }
                });

                // Alternar o details clicado
                if (isOpen) {
                    details.removeAttribute('open');
                    e.target.textContent = '+';
                } else {
                    details.setAttribute('open', '');
                    e.target.textContent = '-';
                }
            }
        });

        // Prevenir comportamento padrão do summary
        document.addEventListener('click', function (e) {
            if (e.target.closest('.product-card summary')) {
                e.preventDefault();
            }
        });
    }

    // 2. Função para configurar a exclusão
    function setupDeleteListeners() {
        document.addEventListener('click', function (e) {
            // Botão de deletar
            if (e.target.classList.contains('delete-button')) {
                e.stopPropagation();

                const productId = e.target.dataset.id;
                const card = e.target.closest('.product-card');
                const modal = card ? card.nextElementSibling : null;

                if (modal && modal.classList.contains('delete-modal')) {
                    const cardRect = card.getBoundingClientRect();

                    modal.style.top = `${cardRect.top + window.scrollY}px`;
                    modal.style.left = `${cardRect.left + window.scrollX}px`;
                    modal.style.width = `${cardRect.width}px`;
                    modal.style.height = `${cardRect.height}px`;
                    modal.classList.remove('hidden');
                }
            }

            // Botão "NÃO" no modal
            if (e.target.classList.contains('confirm-no')) {
                const modal = e.target.closest('.delete-modal');
                if (modal) {
                    modal.classList.add('hidden');
                }
            }

            // Botão "SIM" no modal
            if (e.target.classList.contains('confirm-yes')) {
                const id = e.target.dataset.id;
                const modal = e.target.closest('.delete-modal');

                if (modal) {
                    modal.classList.add('hidden');
                }

                // Exclusão do produto
                setTimeout(async () => {
                    try {
                        const resp = await fetch(`/produtos/${id}`, { method: 'DELETE' });
                        if (resp.ok) {
                            alert('Produto excluído com sucesso!');
                            location.reload();
                        } else {
                            const errorData = await resp.json();
                            alert('Erro ao excluir: ' + (errorData.error || 'desconhecido'));
                        }
                    } catch (err) {
                        console.error(err);
                        alert('Erro de conexão ao excluir produto');
                    }
                }, 100);
            }

            // Clicar fora do modal para fechar
            if (e.target.classList.contains('delete-modal')) {
                e.target.classList.add('hidden');
            }
        });
    }

    // 3. Função para configurar a edição de quantidades (NOVO)
    function setupEditListeners() {
        document.addEventListener('click', function (e) {
            // Botão de edição (ícone de lápis)
            if (e.target.closest('.edit-toggle-btn')) {
                e.stopPropagation();
                const btn = e.target.closest('.edit-toggle-btn');
                const produtoId = btn.dataset.produtoId;
                toggleEditMode(produtoId);
            }

            // Botão confirmar edição (✓)
            if (e.target.classList.contains('confirm-edit')) {
                e.stopPropagation();
                const insumoId = e.target.dataset.insumoId;
                const produtoId = e.target.dataset.produtoId;
                confirmEdit(insumoId, produtoId);
            }

            // Botão cancelar edição (✗)
            if (e.target.classList.contains('cancel-edit')) {
                e.stopPropagation();
                const insumoId = e.target.dataset.insumoId;
                cancelEdit(insumoId);
            }
        });

        // Enter para confirmar edição no input
        document.addEventListener('keypress', function (e) {
            if (e.target.classList.contains('insumo-input') && e.key === 'Enter') {
                e.preventDefault();
                const insumoId = e.target.closest('.insumo-item').dataset.insumoId;
                confirmEdit(insumoId);
            }
        });

        document.addEventListener('click', async function (e) {
            if (e.target.classList.contains('ver-historico-btn')) {
                const produtoId = e.target.dataset.produtoId;
                try {
                    const response = await fetch(`http://127.0.0.1:5000/produtos/${produtoId}`);
                    const data = await response.json();
                    const historico = data.historico_valores || [];

                    if (historico.length === 0) {
                        alert('Nenhum histórico disponível.');
                        return;
                    }

                    let mensagem = 'Histórico de valores:\n\n';
                    historico.forEach(item => {
                        mensagem += `Valor do produto anetiromente: R$ ${item.valor_antigo.toFixed(2)} - Data: ${item.data}\n`;
                    });

                    alert(mensagem);
                } catch (err) {
                    console.error(err);
                    alert('Erro ao buscar histórico');
                }
            }
        });
    }

    // 4. Funções auxiliares para edição
    function toggleEditMode(produtoId) {
        const details = document.querySelector(`.edit-toggle-btn[data-produto-id="${produtoId}"]`).closest('details');
        const isEditing = details.classList.contains('editing-mode');

        if (isEditing) {
            // Desativar modo edição
            details.classList.remove('editing-mode');
            details.querySelectorAll('.insumo-item').forEach(item => {
                const quantidadeSpan = item.querySelector('.insumo-quantidade');
                const input = item.querySelector('.insumo-input');
                const confirmBtn = item.querySelector('.confirm-edit');
                const cancelBtn = item.querySelector('.cancel-edit');

                quantidadeSpan.classList.remove('hidden');
                input.classList.add('hidden');
                confirmBtn.classList.add('hidden');
                cancelBtn.classList.add('hidden');

                // Reverter para valor original
                input.value = input.dataset.originalValue;
            });
        } else {
            // Ativar modo edição
            details.classList.add('editing-mode');
            details.querySelectorAll('.insumo-item').forEach(item => {
                const quantidadeSpan = item.querySelector('.insumo-quantidade');
                const input = item.querySelector('.insumo-input');
                const confirmBtn = item.querySelector('.confirm-edit');
                const cancelBtn = item.querySelector('.cancel-edit');

                quantidadeSpan.classList.add('hidden');
                input.classList.remove('hidden');
                confirmBtn.classList.remove('hidden');
                cancelBtn.classList.remove('hidden');
            });
        }
    }

    async function confirmEdit(insumoId, produtoId) {
        const item = document.querySelector(`.insumo-item[data-insumo-id="${insumoId}"]`);
        const input = item.querySelector('.insumo-input');
        const newValue = parseFloat(input.value);

        if (isNaN(newValue) || newValue < 0) {
            alert('Por favor, insira um valor válido (número positivo)');
            input.value = input.dataset.originalValue;
            return;
        }

        try {
            const response = await fetch(`http://127.0.0.1:5000/produtos/${produtoId}/insumos/${insumoId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ quantidade: newValue })
            });

            if (response.ok) {
                const quantidadeSpan = item.querySelector('.insumo-quantidade');
                quantidadeSpan.textContent = `QTD ${newValue}`;
                input.dataset.originalValue = newValue;

                alert('Quantidade atualizada com sucesso!');
                setTimeout(() => location.reload(), 1000);
            } else {
                const errorData = await response.json();
                alert('Erro ao atualizar: ' + (errorData.error || 'desconhecido'));
                input.value = input.dataset.originalValue;
            }
        } catch (err) {
            console.error(err);
            alert('Erro de conexão ao atualizar quantidade');
            input.value = input.dataset.originalValue;
        }
    }

    function cancelEdit(insumoId) {
        const item = document.querySelector(`.insumo-item[data-insumo-id="${insumoId}"]`);
        const input = item.querySelector('.insumo-input');
        input.value = input.dataset.originalValue;
    }

    // 5. Função para configurar todos os listeners
    function setupAllListeners() {
        setupDetailsListeners();
        setupDeleteListeners();
        setupEditListeners();
    }

    // 6. Função de pesquisa
    function setupSearch() {
        searchInput.addEventListener('input', function () {
            const query = this.value.toLowerCase();
            const productCards = Array.from(productGrid.querySelectorAll('.product-card'));

            productCards.forEach(card => {
                const nomeProduto = card.querySelector('h2')?.textContent.toLowerCase() || '';
                const insumosSection = card.querySelector('.border-t');
                let insumos = [];

                if (insumosSection) {
                    insumos = Array.from(insumosSection.querySelectorAll('.flex span:first-child'))
                        .map(span => span.textContent.toLowerCase());
                }

                const matchProduto = nomeProduto.includes(query);
                const matchInsumo = insumos.some(insumo => insumo.includes(query));

                if (matchProduto || matchInsumo) {
                    card.style.display = '';
                } else {
                    card.style.display = 'none';
                }
            });
        });
    }

    // Inicializar tudo
    setupAllListeners();
    setupSearch();


});