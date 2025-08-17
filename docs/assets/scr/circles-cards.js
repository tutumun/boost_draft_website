// サークル一覧のカード生成・CSVロード処理
async function loadCircles() {
  const res = await fetch("content/circle-list.csv");
  const text = await res.text();
  const rows = text.trim().split(/\r?\n/).map(line => line.split(","));

  return rows.map(r => ({
    name: r[0],
    pn: r[1],
    space: r[2],
    type: r[3]
  }));
}

function renderCards(data) {
  const container = document.getElementById("circleList");
  container.innerHTML = "";
  data.forEach(d => {
    const div = document.createElement("div");
    div.className = "card";
    div.textContent = `${d.space} ${d.name} (${d.pn}) [${d.type}]`;
    container.appendChild(div);
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  const data = await loadCircles();
  renderCards(data);
  window.circleData = data;
});