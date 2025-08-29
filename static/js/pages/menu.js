 document.addEventListener('DOMContentLoaded', function () {
    const toggle = document.getElementById('menu-toggle');
    const menu = document.getElementById('mobile-menu');
    const close = document.getElementById('menu-close');
    const modal = document.getElementById('login-modal');
    const openDesktop = document.getElementById('open-modal-desktop');
    const openMobile = document.getElementById('open-modal-mobile');
    const closeModal = document.getElementById('close-modal');

    if (toggle && menu && close) {
      toggle.addEventListener('click', () => {
        menu.classList.remove('hidden');
      });

      close.addEventListener('click', () => {
        menu.classList.add('hidden');
      });
    }

    // Abrir modal
    [openDesktop, openMobile].forEach(btn => {
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          modal.classList.remove('hidden');
        });
      }
    });

    // Fechar modal
    if (closeModal) {
      closeModal.addEventListener('click', () => {
        modal.classList.add('hidden');
      });
    }

    // Fechar ao clicar fora do conteúdo
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
      }
    });
  });