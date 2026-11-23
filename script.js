(function () {
  "use strict";

  const select = (selector) => document.querySelector(selector);
  const artworkColors = ["#93dc5d", "#b6e893", "#ddf3c9", "#c4f651"];
  const localCopy = location.protocol === "file:"
    || location.hostname === "localhost"
    || location.hostname === "127.0.0.1";
  const state = {
    projects: [],
    projectFolder: null,
    projectIndex: null,
    admin: false,
    dirty: false,
    replaceBlockIndex: null,
    mediaPreviews: new WeakMap(),
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function currentProject() {
    return state.projects[state.projectIndex] || null;
  }

  function ensureProjectBlocks(project) {
    if (!Array.isArray(project.blocks)) {
      project.blocks = [];
    }

    return project.blocks;
  }

  function releaseMediaPreview(block) {
    const preview = state.mediaPreviews.get(block);
    if (preview) {
      URL.revokeObjectURL(preview);
      state.mediaPreviews.delete(block);
    }
  }

  function showToast(message) {
    const toast = select("#toast");
    toast.textContent = message;
    toast.classList.add("on");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("on"), 2600);
  }

  function setAdminStatus(message, isError) {
    const status = select("#admin-status");
    status.textContent = message;
    status.classList.toggle("error", Boolean(isError));
  }

  function markDirty() {
    state.dirty = true;
    setAdminStatus("Not saved");
  }

  function editAttributes(field, index, placeholder) {
    if (!state.admin) {
      return "";
    }

    return ` contenteditable="true" spellcheck="false" data-project-field="${field}" data-project-index="${index}" data-placeholder="${placeholder}"`;
  }

  function getMediaUrl(path) {
    if (!path) {
      return "";
    }

    try {
      const localPath = path.startsWith("/uploads/")
        ? path.slice(1)
        : location.protocol === "file:" && path.startsWith("/")
        ? path.slice(1)
        : path;
      const url = new URL(localPath, document.baseURI);
      return ["file:", "http:", "https:"].includes(url.protocol) ? url.href : "";
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
    const source = cover
      ? state.mediaPreviews.get(cover) || getMediaUrl(cover.file)
      : "";

    if (source) {
      return `<img class="m" src="${escapeHtml(source)}" alt="${escapeHtml(project.title)}">`;
    }

    const color = artworkColors[index % artworkColors.length];
    return `<div class="m art" style="--art-color:${color}">${escapeHtml(project.title)}</div>`;
  }

  function projectControls(index) {
    if (!state.admin) {
      return "";
    }

    return `
      <div class="project-controls admin-only">
        <button type="button" data-project-action="up" data-index="${index}" aria-label="Move project up">↑</button>
        <button type="button" data-project-action="down" data-index="${index}" aria-label="Move project down">↓</button>
        <button type="button" data-project-action="delete" data-index="${index}" aria-label="Delete project">×</button>
      </div>
    `;
  }

  function renderHome() {
    const grid = select("#grid");
    const visibleProjects = state.projects
      .map((project, index) => ({ project, index }))
      .filter(({ project }) => state.admin
        || String(project.title || "").trim()
        || coverFor(project));

    grid.innerHTML = visibleProjects.map(({ project, index }) => {
      const hasTitle = String(project.title || "").trim().length > 0;
      const hasTag = String(project.tag || "").trim().length > 0;
      const hasYear = String(project.year || "").trim().length > 0;
      const showTitle = hasTitle || state.admin;
      const showDetails = hasTag || hasYear || state.admin;
      const meta = showTitle || showDetails ? `
        <div class="meta">
          ${showTitle ? `
            <div class="meta-title">
              <span class="project-number">${String(index + 1).padStart(2, "0")}</span>
              <h3${editAttributes("title", index, "Project title")}>${escapeHtml(project.title)}</h3>
            </div>
          ` : ""}
          ${showDetails ? `
            <div class="tag">
              ${hasTag || state.admin ? `<span${editAttributes("tag", index, "Type")}>${escapeHtml(project.tag)}</span>` : ""}
              ${hasTag && hasYear ? '<span aria-hidden="true"> - </span>' : ""}
              ${hasYear || state.admin ? `<span${editAttributes("year", index, "Year")}>${escapeHtml(project.year)}</span>` : ""}
            </div>
          ` : ""}
        </div>
      ` : "";

      return `
        <article class="card">
          <a class="card-cover" href="#/p/${index}" aria-label="Open ${escapeHtml(project.title || "project")}">
            ${projectTile(project, index)}
          </a>
          ${meta}
          ${projectControls(index)}
        </article>
      `;
    }).join("") || '<p class="empty">Selected work will appear here.</p>';

    const topics = ["Motion design", "Branding", "Visual identity", "Graphic design"];
    select("#tape").innerHTML = topics.concat(topics)
      .map((topic) => `${escapeHtml(topic)} &nbsp;✦&nbsp; `)
      .join("")
      .repeat(2);
  }

  function blockControls(block, index) {
    if (!state.admin) {
      return "";
    }

    return `
      <div class="block-controls admin-only">
        ${block.type === "image" || block.type === "video"
          ? `<button type="button" data-block-action="replace" data-index="${index}" aria-label="Replace media">Replace</button>`
          : ""}
        <button type="button" data-block-action="up" data-index="${index}" aria-label="Move block up">↑</button>
        <button type="button" data-block-action="down" data-index="${index}" aria-label="Move block down">↓</button>
        <button type="button" data-block-action="width" data-index="${index}" aria-label="Toggle block width">↔</button>
        ${block.type === "image"
          ? `<button type="button" data-block-action="cover" data-index="${index}" class="${block.cover ? "selected" : ""}" aria-label="Set project cover">★</button>`
          : ""}
        <button type="button" data-block-action="remove" data-index="${index}" aria-label="Remove block">×</button>
      </div>
    `;
  }

  function blockHtml(block, index) {
    const widthClass = block.w === "half" ? " half" : "";
    const source = state.mediaPreviews.get(block) || getMediaUrl(block.file);
    const controls = blockControls(block, index);
    const editableText = (placeholder) => state.admin
      ? ` contenteditable="true" spellcheck="false" data-block-field="text" data-index="${index}" data-placeholder="${placeholder}"`
      : "";

    if (block.type === "image") {
      if (!source && !state.admin) {
        return "";
      }

      const media = source
        ? `<img src="${escapeHtml(source)}" alt="">`
        : state.admin ? '<div class="media-empty">Choose “Photo / video” to add an image.</div>' : "";
      return `<figure class="b${widthClass}" data-block="${index}">${media}${controls}</figure>`;
    }

    if (block.type === "video") {
      if (!source && !state.admin) {
        return "";
      }

      const media = source
        ? `<video src="${escapeHtml(source)}" controls loop muted playsinline></video>`
        : state.admin ? '<div class="media-empty">Choose “Photo / video” to add a video.</div>' : "";
      return `<figure class="b${widthClass}" data-block="${index}">${media}${controls}</figure>`;
    }

    if (block.type === "heading") {
      if (!String(block.text || "").trim() && !state.admin) {
        return "";
      }

      return `
        <div class="b t h" data-block="${index}">
          <div class="block-content"${editableText("Heading")}>${escapeHtml(block.text)}</div>
          ${controls}
        </div>
      `;
    }

    if (block.type === "text") {
      if (!String(block.text || "").trim() && !state.admin) {
        return "";
      }

      return `
        <div class="b t${widthClass}" data-block="${index}">
          <div class="block-content"${editableText("Text")}>${escapeHtml(block.text)}</div>
          ${controls}
        </div>
      `;
    }

    return "";
  }

  function renderProject(project) {
    const blocks = Array.isArray(project.blocks) ? project.blocks : [];
    const renderedBlocks = blocks.map(blockHtml).join("");
    const hasTag = String(project.tag || "").trim().length > 0;
    const hasYear = String(project.year || "").trim().length > 0;
    const hasTitle = String(project.title || "").trim().length > 0;
    const hasDescription = String(project.desc || "").trim().length > 0;
    const hasHeader = state.admin || hasTag || hasYear || hasTitle || hasDescription;
    select("#proj").innerHTML = `
      <a class="back" href="#/work">← Back to work</a>
      ${hasHeader ? `
        <div class="ph">
          ${hasTag || hasYear || state.admin ? `
            <div class="project-kicker">
              ${hasTag || state.admin ? `<span class="project-type"${editAttributes("tag", state.projectIndex, "Type")}>${escapeHtml(project.tag)}</span>` : ""}
              ${hasTag && hasYear ? '<span class="project-separator" aria-hidden="true">-</span>' : ""}
              ${hasYear || state.admin ? `<span class="project-year"${editAttributes("year", state.projectIndex, "Year")}>${escapeHtml(project.year)}</span>` : ""}
            </div>
          ` : ""}
          ${hasTitle || state.admin ? `<h1${editAttributes("title", state.projectIndex, "Project title")}>${escapeHtml(project.title)}</h1>` : ""}
          ${hasDescription || state.admin ? `
            <div class="project-intro">
              <p${editAttributes("desc", state.projectIndex, "Short description")}>${escapeHtml(project.desc)}</p>
            </div>
          ` : ""}
        </div>
      ` : ""}
      ${renderedBlocks ? `<div class="blocks">${renderedBlocks}</div>` : ""}
    `;
  }

  function drawPage() {
    document.body.classList.toggle("admin", state.admin);
    document.body.classList.toggle("inproj", state.projectIndex !== null);
    select("#home").hidden = state.projectIndex !== null;
    select("#proj").hidden = state.projectIndex === null;

    if (state.projectIndex === null) {
      renderHome();
      return;
    }

    const project = currentProject();
    if (!project) {
      location.hash = "#/";
      return;
    }

    renderProject(project);
  }

  function routePage() {
    const match = location.hash.match(/^#\/p\/(\d+)$/);
    state.projectIndex = match ? Number(match[1]) : null;
    drawPage();

    if (state.projectIndex !== null) {
      window.scrollTo(0, 0);
    } else if (location.hash === "#/work" || location.hash === "#/about") {
      const targetSelector = location.hash === "#/work" ? "#work" : "#about";
      const target = select(targetSelector);
      window.setTimeout(() => target.scrollIntoView(), 30);
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

    state.projects = data.projects;
    routePage();
  }

  async function enableAdmin() {
    if (!localCopy) {
      showToast("Admin is available only in the local portfolio copy.");
      return;
    }

    if (!("showDirectoryPicker" in window)) {
      showToast("Open the local portfolio in a recent version of Chrome or Edge.");
      return;
    }

    try {
      const folder = await window.showDirectoryPicker({ mode: "readwrite" });
      await folder.getFileHandle("index.html");
      const content = await folder.getDirectoryHandle("content");
      const fileHandle = await content.getFileHandle("projects.json");
      const file = await fileHandle.getFile();
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.projects)) {
        throw new Error("content/projects.json is not a valid project list.");
      }

      state.projectFolder = folder;
      state.projects = data.projects;
      state.admin = true;
      state.dirty = false;
      select("#admin-status").textContent = "Local editor ready";
      routePage();
      showToast("Edit mode on. Changes appear directly on the page.");
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error("Could not open portfolio folder:", error);
        showToast(`Could not open portfolio folder: ${error.message}`);
      }
    }
  }

  async function saveProjects() {
    if (!state.admin || !state.projectFolder) {
      showToast("Open local edit mode first.");
      return false;
    }

    const content = await state.projectFolder.getDirectoryHandle("content", { create: true });
    const fileHandle = await content.getFileHandle("projects.json", { create: true });
    const writable = await fileHandle.createWritable();

    try {
      await writable.write(`${JSON.stringify({ projects: state.projects }, null, 2)}\n`);
      await writable.close();
    } catch (error) {
      await writable.abort();
      throw error;
    }

    state.dirty = false;
    setAdminStatus("Saved on this computer");
    showToast("Saved. Push with GitHub Desktop to publish it.");
    return true;
  }

  function createProject() {
    if (!state.admin) {
      return;
    }

    state.projects.push({
      title: "New project",
      tag: "",
      year: String(new Date().getFullYear()),
      desc: "",
      blocks: [],
    });
    state.projectIndex = state.projects.length - 1;
    markDirty();
    location.hash = `#/p/${state.projectIndex}`;
    drawPage();
    select("#proj h1").focus();
    document.execCommand && document.execCommand("selectAll");
  }

  function addTextBlock(type) {
    const project = currentProject();
    if (!state.admin || !project) {
      showToast("Open a project first.");
      return;
    }

    const blocks = ensureProjectBlocks(project);
    blocks.push({ type, text: "", w: "full" });
    markDirty();
    drawPage();
    const blockIndex = blocks.length - 1;
    const field = select(`[data-block-field="text"][data-index="${blockIndex}"]`);
    if (field) {
      field.focus();
      field.scrollIntoView({ block: "center" });
    }
  }

  function safeFileName(file) {
    const extension = file.name.match(/\.[a-z0-9]{1,8}$/i);
    const suffix = extension ? extension[0].toLowerCase() : "";
    const stem = file.name
      .replace(/\.[^.]+$/, "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "media";
    return `${stem}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${suffix}`;
  }

  async function storeMedia(file) {
    if (file.size > 50 * 1024 * 1024) {
      throw new Error("Keep uploads under 50 MB so GitHub can store them.");
    }

    const type = file.type.startsWith("image/")
      ? "image"
      : file.type.startsWith("video/")
        ? "video"
        : null;
    if (!type) {
      throw new Error("Choose an image or video file.");
    }

    const uploads = await state.projectFolder.getDirectoryHandle("uploads", { create: true });
    const filename = safeFileName(file);
    const fileHandle = await uploads.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();

    try {
      await writable.write(file);
      await writable.close();
    } catch (error) {
      await writable.abort();
      throw error;
    }

    return { type, file: `uploads/${filename}`, w: "full" };
  }

  async function addMedia(files) {
    const project = currentProject();
    if (!state.admin || !project) {
      showToast("Open a project before adding media.");
      return;
    }

    const blocks = ensureProjectBlocks(project);
    const fileList = Array.from(files);
    let added = 0;
    try {
      for (const file of fileList) {
        const block = await storeMedia(file);
        const replaceIndex = state.replaceBlockIndex;
        let visibleBlock = block;
        if (replaceIndex !== null && fileList.length === 1) {
          const previousBlock = blocks[replaceIndex];
          if (previousBlock) {
            releaseMediaPreview(previousBlock);
          }
          visibleBlock = { ...previousBlock, ...block };
          blocks[replaceIndex] = visibleBlock;
        } else {
          blocks.push(visibleBlock);
        }
        state.mediaPreviews.set(visibleBlock, URL.createObjectURL(file));
        added += 1;
        markDirty();
      }

      if (added) {
        state.replaceBlockIndex = null;
        drawPage();
        await saveProjects();
        showToast(`${added} media file${added === 1 ? "" : "s"} added and saved.`);
      }
    } catch (error) {
      console.error("Could not add project media:", error);
      if (added) {
        drawPage();
      }
      showToast(error.message || "Media upload failed.");
    }
  }

  function openMediaPicker(replaceIndex) {
    if (!currentProject()) {
      if (state.projects.length !== 1) {
        showToast(state.projects.length
          ? "Open the project you want to add photos to."
          : "Create a project before adding photos.");
        return;
      }

      state.projectIndex = 0;
      location.hash = "#/p/0";
      drawPage();
      window.scrollTo(0, 0);
    }

    state.replaceBlockIndex = replaceIndex;
    select("#media-file").click();
  }

  async function deleteProject(index) {
    const project = state.projects[index];
    if (!project || !window.confirm(`Delete "${project.title || "Untitled project"}"?`)) {
      return;
    }

    (Array.isArray(project.blocks) ? project.blocks : []).forEach(releaseMediaPreview);
    state.projects.splice(index, 1);
    if (state.projectIndex === index) {
      location.hash = "#/work";
      state.projectIndex = null;
    } else if (state.projectIndex !== null && state.projectIndex > index) {
      state.projectIndex -= 1;
    }

    markDirty();
    drawPage();
  }

  function handleProjectControls(event) {
    const button = event.target.closest("[data-project-action]");
    if (!button || !state.admin) {
      return false;
    }

    event.preventDefault();
    const index = Number(button.dataset.index);
    const action = button.dataset.projectAction;

    if (action === "delete") {
      deleteProject(index);
      return true;
    }

    const nextIndex = index + (action === "up" ? -1 : 1);
    if (nextIndex < 0 || nextIndex >= state.projects.length) {
      return true;
    }

    [state.projects[index], state.projects[nextIndex]] = [
      state.projects[nextIndex],
      state.projects[index],
    ];
    markDirty();
    renderHome();
    return true;
  }

  function handleBlockControls(event) {
    const button = event.target.closest("[data-block-action]");
    const project = currentProject();
    if (!button || !state.admin || !project) {
      return false;
    }

    event.preventDefault();
    const index = Number(button.dataset.index);
    const action = button.dataset.blockAction;
    const block = project.blocks[index];

    if (action === "replace") {
      openMediaPicker(index);
      return true;
    }

    if (action === "remove") {
      releaseMediaPreview(block);
      project.blocks.splice(index, 1);
    } else if (action === "cover") {
      project.blocks.forEach((item) => {
        if (item.type === "image") {
          item.cover = false;
        }
      });
      block.cover = true;
    } else if (action === "width") {
      block.w = block.w === "half" ? "full" : "half";
    } else if (action === "up" && index > 0) {
      [project.blocks[index - 1], project.blocks[index]] = [
        project.blocks[index],
        project.blocks[index - 1],
      ];
    } else if (action === "down" && index < project.blocks.length - 1) {
      [project.blocks[index + 1], project.blocks[index]] = [
        project.blocks[index],
        project.blocks[index + 1],
      ];
    }

    markDirty();
    drawPage();
    return true;
  }

  function updateEditedContent(target) {
    if (!state.admin) {
      return;
    }

    const value = (target.innerText || "").replace(/\n+$/, "");
    if (target.dataset.projectField) {
      const index = Number(target.dataset.projectIndex);
      const project = state.projects[index];
      const field = target.dataset.projectField;
      if (!project || !["title", "tag", "year", "desc"].includes(field)) {
        return;
      }

      project[field] = field === "desc" ? value : value.trim();
      markDirty();
      return;
    }

    if (target.dataset.blockField === "text") {
      const project = currentProject();
      const block = project && project.blocks[Number(target.dataset.index)];
      if (block) {
        block.text = value;
        markDirty();
      }
    }
  }

  select(".brand").addEventListener("click", (event) => {
    if (state.admin) {
      return;
    }

    select(".brand").dataset.clicks = String(
      Number(select(".brand").dataset.clicks || 0) + 1,
    );
    window.clearTimeout(select(".brand").clickTimer);

    if (Number(select(".brand").dataset.clicks) >= 5) {
      event.preventDefault();
      select(".brand").dataset.clicks = "0";
      enableAdmin();
      return;
    }

    select(".brand").clickTimer = window.setTimeout(() => {
      select(".brand").dataset.clicks = "0";
    }, 1800);
  });

  window.addEventListener("hashchange", routePage);

  select("#grid").addEventListener("click", (event) => {
    handleProjectControls(event);
    if (state.admin && event.target.closest("[contenteditable]")) {
      event.stopPropagation();
    }
  });

  select("#proj").addEventListener("click", (event) => {
    handleBlockControls(event);
  });

  document.addEventListener("input", (event) => {
    if (event.target.matches("[contenteditable]")) {
      updateEditedContent(event.target);
    }
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const singleLineField = ["title", "tag", "year"].includes(target.dataset.projectField)
      || target.dataset.blockField === "text" && target.closest(".b.h");
    if (state.admin && event.key === "Enter" && singleLineField) {
      event.preventDefault();
      target.blur();
    }
  });

  select("#admin-bar").addEventListener("click", (event) => {
    const button = event.target.closest("[data-admin-action]");
    if (!button) {
      return;
    }

    const action = button.dataset.adminAction;
    if (action === "new") {
      createProject();
    } else if (action === "media") {
      openMediaPicker(null);
    } else if (action === "heading" || action === "text") {
      addTextBlock(action);
    } else if (action === "save") {
      saveProjects().catch((error) => {
        console.error("Could not save projects:", error);
        setAdminStatus("Save failed", true);
        showToast(`Save failed: ${error.message}`);
      });
    } else if (action === "exit") {
      if (state.dirty) {
        if (!window.confirm("You have unsaved changes. Exit without saving?")) {
          return;
        }
        window.location.reload();
        return;
      }
      state.admin = false;
      state.projectFolder = null;
      state.dirty = false;
      drawPage();
      showToast("Edit mode off.");
    }
  });

  select("#media-file").addEventListener("change", function () {
    addMedia(this.files);
    this.value = "";
  });

  loadProjects().catch((error) => {
    console.error("Could not load portfolio projects:", error);
    select("#grid").innerHTML = '<p class="empty" role="alert">Could not load projects. Refresh the page and try again.</p>';
  });
})();
