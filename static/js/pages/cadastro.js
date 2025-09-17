
function fecharPopupCadastro() {
  const popup = document.getElementById("popup-cadastro");
  if (popup) {
    popup.classList.remove("show");
  }
}

function fecharPopupCadastroErro() {
  const popup = document.getElementById("popup-cadastro-erro");
  if (popup) {
    popup.classList.remove("show");
  }
}

document.addEventListener("DOMContentLoaded", function () {
  const form = document.querySelector("form");
  const popupOk = document.getElementById("popup-cadastro");
  const popupErro = document.getElementById("popup-cadastro-erro");

  if (form) {
    form.addEventListener("submit", function (e) {
      const inputs = form.querySelectorAll("input");
      let todosPreenchidos = true;
      inputs.forEach(inp => {
        if (!inp.value.trim()) {
          todosPreenchidos = false;
        }
      });

      if (!todosPreenchidos) {
        e.preventDefault(); // impede envio ao banco
        if (popupErro) {
          popupErro.classList.add("show");
          setTimeout(() => fecharPopupCadastroErro(), 3000);
        }
      } else {
        if (popupOk) {
          popupOk.classList.add("show");
          setTimeout(() => fecharPopupCadastro(), 3000);
        }
      }
    });
  }
});
