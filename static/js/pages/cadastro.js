// cadastro.js
document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("form");

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const codigo = document.getElementById("codigo").value.trim();
    const nome = document.getElementById("nome").value.trim();
    const fornecedor = document.getElementById("fornecedor").value.trim();

    if (!codigo || !nome || !fornecedor) {
      alert("Preencha todos os campos obrigatórios!");
      return;
    }

    alert("Cadastro enviado com sucesso!");
    form.reset();
  });
});
