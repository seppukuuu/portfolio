(function () {
  "use strict";

  const select = (selector) => document.querySelector(selector);
  const artworkColors = ["#8cff54", "#f2efe6", "#d6d1c2", "#c5ffad"];
  let projects = [];
  let currentProjectIndex = null;

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function getMediaUrl(path) {
    if (!path) {
      return "";
    }

    try {
      const url = new URL(path, document.baseURI);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch (error) {
      return "";
    }
  }

  function coverFor(project) {
    const blocks = Array.isArray(project.blocks) ? project.blocks : [];
    return blocks.find((block) => block.type === "image" && block.cover && block.file)
      || blocks.find((block) => block.type === "image" && block.file);
  }

  function projectTile(project, index) {
    const cover = coverFor(project);

    const source = cover ? getMediaUrl(cover.file) : "";
    if (source) {
      return `<img class="m" src="${escapeHtml(source)}" alt="${escapeHtml(project.title)}">`;
    }

    const color = artworkColors[index % artworkColors.length];
    return `<div class="m art" style="background:${color};color:#111">${escapeHtml(project.title)}</div>`;
  }

  function renderHome() {
    select("#grid").innerHTML = projects.map((project, index) => `
      <a class="card" href="#/p/${index}">
        ${projectTile(project, index)}
        <div class="meta">
          <div class="meta-title">
            <span class="project-number">${String(index + 1).padStart(2, "0")}</span>
            <h3>${escapeHtml(project.title)}</h3>
          </div>
          <span class="tag">${escapeHtml([project.tag, project.year].filter(Boolean).join(" · "))}</span>
        </div>
      </a>
    `).join("") || '<p class="empty">Binnenkort nieuw werk.</p>';

    const topics = ["Motion design", "Branding", "Visual identity", "Graphic design"];
    select("#tape").innerHTML = topics.concat(topics)
      .map((topic) => `${escapeHtml(topic)} &nbsp;✦&nbsp; `)
      .join("")
      .repeat(2);
  }

  function blockHtml(block) {
    const widthClass = block.w === "half" ? " half" : "";
    const source = getMediaUrl(block.file);

    if (block.type === "image" && source) {
      return `<figure class="b${widthClass}"><img src="${escapeHtml(source)}" alt=""></figure>`;
    }

    if (block.type === "video" && source) {
      return `<figure class="b${widthClass}"><video src="${escapeHtml(source)}" controls loop muted playsinline></video></figure>`;
    }

    if (block.type === "heading") {
      return `<div class="b t h"><div class="block-content">${escapeHtml(block.text)}</div></div>`;
    }

    if (block.type === "text") {
      return `<div class="b t${widthClass}"><div class="block-content">${escapeHtml(block.text)}</div></div>`;
    }

    return "";
  }

  function renderProject(project) {
    const blocks = Array.isArray(project.blocks) ? project.blocks : [];
    select("#proj").innerHTML = `
      <a class="back" href="#/work">← Back</a>
      <div class="ph">
        <div class="project-kicker">
          <span class="eyebrow">Selected project</span>
          <span class="project-type">${escapeHtml(project.tag)}</span>
        </div>
        <h1>${escapeHtml(project.title)}</h1>
        <div class="project-intro">
          <div class="project-year">
            <span class="eyebrow">Year</span>
            <span>${escapeHtml(project.year)}</span>
          </div>
          <p>${escapeHtml(project.desc)}</p>
        </div>
      </div>
      <div class="blocks">${blocks.map(blockHtml).join("")}</div>
    `;
  }

  function drawPage() {
    document.body.classList.toggle("inproj", currentProjectIndex !== null);
    select("#home").hidden = currentProjectIndex !== null;
    select("#proj").hidden = currentProjectIndex === null;

    if (currentProjectIndex === null) {
      renderHome();
      return;
    }

    const project = projects[currentProjectIndex];
    if (!project) {
      location.hash = "#/";
      return;
    }

    renderProject(project);
  }

  function routePage() {
    const match = location.hash.match(/^#\/p\/(\d+)$/);
    currentProjectIndex = match ? Number(match[1]) : null;
    drawPage();

    if (currentProjectIndex !== null) {
      window.scrollTo(0, 0);
    } else if (location.hash === "#/work" || location.hash === "#/about") {
      const target = select(location.hash === "#/work" ? "#work" : "#about");
      setTimeout(() => target.scrollIntoView(), 30);
    } else {
      window.scrollTo(0, 0);
    }
  }

  async function loadProjects() {
    const response = await fetch("content/projects.json", { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`Could not load projects (${response.status}).`);
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.projects)) {
      throw new Error("The project content file has an invalid format.");
    }

    projects = data.projects;
    routePage();
  }

  window.addEventListener("hashchange", routePage);

  loadProjects().catch((error) => {
    console.error("Could not load portfolio projects:", error);
    select("#grid").innerHTML = '<p class="empty" role="alert">Projecten laden mislukt. Vernieuw de pagina of probeer later opnieuw.</p>';
  });
})();
