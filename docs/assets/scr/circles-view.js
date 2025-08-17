// 表示切替とソート処理
function renderTable(data) {
  const container = document.getElementById("circleList");
  container.innerHTML = "";
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>スペース</th><th>サークル名</th><th>PN</th><th>区分</th></tr>";
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  data.forEach(d => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${d.space}</td><td>${d.name}</td><td>${d.pn}</td><td>${d.type}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

document.getElementById("viewCards").addEventListener("click", () => {
  renderCards(window.circleData);
});

document.getElementById("viewTable").addEventListener("click", () => {
  renderTable(window.circleData);
});

document.getElementById("sortKana").addEventListener("click", () => {
  const sorted = [...window.circleData].sort((a, b) => a.name.localeCompare(b.name, "ja"));
  renderCards(sorted);
});

document.getElementById("sortSpace").addEventListener("click", () => {
  const sorted = [...window.circleData].sort((a, b) => a.space.localeCompare(b.space, "ja"));
  renderCards(sorted);
});