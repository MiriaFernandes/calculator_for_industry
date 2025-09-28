document.addEventListener('DOMContentLoaded', () => {
  const barraPesquisa = document.getElementById('barra-pesquisa');
  const filtroRadios = document.querySelectorAll('.filtro-radio');
  const tabelaItens = document.getElementById('tabela-itens');

  let filtroAtual = 'materia';
  let itensOriginais = [];

  // Captura os dados da tabela renderizada pelo Jinja
  tabelaItens.querySelectorAll('tr').forEach(row => {
    const cols = row.querySelectorAll('td');
    itensOriginais.push({
      data_emissao: cols[0].textContent.trim(),
      nome: cols[1].textContent.trim(),
      fornecedor: cols[2].textContent.trim(),
      unidade: cols[3].textContent.trim(),
      valor_unitario: cols[4].textContent.trim()
    });
  });

  // Atualiza filtro
  filtroRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      filtroAtual = radio.value;
      filtrarTabela();
    });
  });

  // Filtra ao digitar
  barraPesquisa.addEventListener('input', filtrarTabela);

  function filtrarTabela() {
    const termo = barraPesquisa.value.toLowerCase();
    const filtrados = itensOriginais.filter(item => {
      if (filtroAtual === 'materia') {
        return item.nome.toLowerCase().includes(termo);
      } else {
        return item.fornecedor.toLowerCase().includes(termo);
      }
    });

    tabelaItens.innerHTML = '';
    filtrados.forEach(item => {
      tabelaItens.innerHTML += `
        <tr class="border-t">
          <td class="px-4 py-2">${item.data_emissao}</td>
          <td class="px-4 py-2">${item.nome}</td>
          <td class="px-4 py-2">${item.fornecedor}</td>
          <td class="px-4 py-2">${item.unidade}</td>
          <td class="px-4 py-2">${item.valor_unitario}</td>
        </tr>
      `;
    });
  }
});
