const setText = (selector, value) => {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
};

const setAllText = (selector, values) => {
  document.querySelectorAll(selector).forEach((node, index) => {
    if (values[index]) node.textContent = values[index];
  });
};

function installCopy() {
  document.documentElement.classList.add("rwn-professional");
  document.body.classList.add("rwn-professional");
  document.querySelector(".finder-intro")?.setAttribute("data-copy-source", "app-shell");
}

export function installProfessionalPresentation() {
  if (document.querySelector(".finder-intro")) {
    installCopy();
    return;
  }

  let frames = 0;
  const waitForShell = () => {
    if (document.querySelector(".finder-intro")) {
      installCopy();
      return;
    }
    frames += 1;
    if (frames < 240) requestAnimationFrame(waitForShell);
  };
  waitForShell();
}

installProfessionalPresentation();
