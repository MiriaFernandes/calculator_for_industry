
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className =
    "flex items-center w-full max-w-xs p-4 text-gray-700 bg-white rounded-lg shadow-md border space-x-2 animate-fade-in";
  if (type === "success") {
    toast.classList.add("border-green-300");
  } else if (type === "error") {
    toast.classList.add("border-red-300");
  }

  toast.innerHTML = `
    <svg class="w-6 h-6 ${type === "success" ? "text-green-600" : "text-red-600"} flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${type === "success" ? "M5 13l4 4L19 7" : "M6 18L18 6M6 6l12 12"}" />
    </svg>
    <span class="text-sm font-medium">${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// Ativa automaticamente se o servidor enviar a flag message
document.addEventListener("DOMContentLoaded", () => {
  if (typeof SERVER_MESSAGE !== "undefined" && SERVER_MESSAGE === "ok") {
    showToast("Item enviado para o banco de dados", "success");
  }
});
