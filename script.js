const sidebar = document.getElementById("sidebar");
const mainContent = document.querySelector(".main-content");
const toggle = document.getElementById("sidebarToggle");

toggle.addEventListener("click", () => {
  sidebar.classList.toggle("hidden");
  mainContent.classList.toggle("expanded");
});