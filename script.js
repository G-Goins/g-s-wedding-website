const siteHeader = document.getElementById("siteHeader");

window.addEventListener("scroll", () => {
  if (window.scrollY > 40) {
    siteHeader.classList.add("scrolled");
  } else {
    siteHeader.classList.remove("scrolled");
  }
});