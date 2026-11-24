(function () {
  "use strict";

  const select = (selector) => document.querySelector(selector);
  const artworkColors = ["#93dc5d", "#b6e893", "#ddf3c9", "#c4f651"];
  const localCopy = location.protocol === "file:"
    || location.hostname === "localhost"
    || location.hostname === "127.0.0.1";
  const editorSessionKey = "seppe-portfolio-editor-active";
  const editorDatabaseName = "seppe-portfolio-local-editor";
  const state = {
    projects: [],
    projectFolder: null,
    projectIndex: null,
    admin: false,
    dirty: false,
    replaceBlockIndex: null,
    mediaPreviews: new WeakMap(),
    coverPreviews: new WeakMap(),
    mediaProjectIndex: null,
    mediaInsertIndex: null,
    mediaEditorContext: null,
    draggedBlockIndex: null,
    blockPointerDrag: null,
    activePreviewEditorIndex: null,
    previewEditorOpen: false,
  };
  let coverPointerDrag = null;
  let suppressCoverClick = false;

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

  function mediaWidth(block) {
    const width = Number(block.width);
    if (Number.isFinite(width) && width >= 1 && width <= 100) {
      return Math.round(width);
    }
    return block.w === "half" ? 50 : 100;
  }

  function setMediaWidth(block, width) {
    block.width = width;
    block.w = width === 50 ? "half" : "full";
  }

  function pairMediaBlocks(project, block, targetBlock) {
    const blockIndex = project.blocks.indexOf(block);
    const targetIndex = project.blocks.indexOf(targetBlock);
    if (blockIndex < 0 || Math.abs(blockIndex - targetIndex) !== 1) {
      return false;
    }

    const first = project.blocks[Math.min(blockIndex, targetIndex)];
    const second = project.blocks[Math.max(blockIndex, targetIndex)];
    let changed = false;
    if (mediaWidth(first) !== 50 || first.w !== "half") {
      setMediaWidth(first, 50);
      changed = true;
    }
    if (mediaWidth(second) !== 50 || second.w !== "half") {
      setMediaWidth(second, 50);
      changed = true;
    }
    if (first.align !== "left" || second.align !== "right") {
      first.align = "left";
      second.align = "right";
      changed = true;
    }

    return changed;
  }

  function applyMediaWidthControl(control, block, value) {
    const parsedWidth = Number(value);
    const width = Number.isFinite(parsedWidth)
      ? Math.min(100, Math.max(1, Math.round(parsedWidth)))
      : mediaWidth(block);
    const controls = control.closest(".media-size-control");

    setMediaWidth(block, width);
    controls.querySelector("[data-block-size]").value = String(width);
    controls.querySelector("[data-block-size-number]").value = String(width);
    control.closest(".media-block").style.gridColumn = mediaGridStyle(block);
    markDirty();
  }

  function mediaGridStyle(block) {
    const width = mediaWidth(block);
    if (!["left", "center", "right"].includes(block.align)) {
      return `span ${width}`;
    }

    const start = block.align === "left"
      ? 1
      : block.align === "right"
        ? 101 - width
        : Math.floor((100 - width) / 2) + 1;
    return `${start} / span ${width}`;
  }

  function isMediaBlock(block) {
    return block && ["image", "video", "youtube"].includes(block.type);
  }

  function youtubeEmbedUrl(value) {
    try {
      const url = new URL(String(value).trim());
      if (!["http:", "https:"].includes(url.protocol)) return "";

      const host = url.hostname.toLowerCase();
      let videoId = "";
      if (host === "youtu.be") {
        videoId = url.pathname.split("/")[1] || "";
      } else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) {
        videoId = url.searchParams.get("v")
          || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1]
          || "";
      }

      return /^[A-Za-z0-9_-]{11}$/.test(videoId)
        ? `https://www.youtube-nocookie.com/embed/${videoId}`
        : "";
    } catch (error) {
      return "";
    }
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
    if (project.coverFile) {
      return { file: project.coverFile };
    }
    const blocks = Array.isArray(project.blocks) ? project.blocks : [];
    return blocks.find((block) => block.type === "image" && block.cover && block.file)
      || blocks.find((block) => block.type === "image" && block.file);
  }

  function projectTile(project, index) {
    const cover = coverFor(project);
    const source = cover
      ? project.coverFile
        ? state.coverPreviews.get(project) || getMediaUrl(project.coverFile)
        : state.mediaPreviews.get(cover) || getMediaUrl(cover.file)
      : "";
    const coverBackground = String(project.coverBg || "").trim();

    if (source) {
      return `<div class="m cover-media" style="--cover-bg:${escapeHtml(coverBackground || "#dedbd2")}"><img src="${escapeHtml(source)}" alt="${escapeHtml(project.title)}" data-cover-image="${index}"></div>`;
    }

    const color = artworkColors[index % artworkColors.length];
    return `<div class="m art" style="--art-color:${color}">${escapeHtml(project.title)}</div>`;
  }

  function applyCoverFraming(image, project) {
    if (!image.naturalWidth || !image.naturalHeight) return;

    const frame = image.parentElement.getBoundingClientRect();
    if (!frame.width || !frame.height) return;

    const scale = Math.max(frame.width / image.naturalWidth, frame.height / image.naturalHeight);
    const zoomValue = Number(project.coverZoom);
    const zoom = project.coverZoom !== null && project.coverZoom !== undefined
      && Number.isFinite(zoomValue)
      ? Math.min(2.5, Math.max(0.5, zoomValue))
      : 1;
    const width = image.naturalWidth * scale * zoom;
    const height = image.naturalHeight * scale * zoom;
    const position = project.coverPosition || { x: 50, y: 50 };
    const x = Number.isFinite(Number(position.x)) ? Number(position.x) : 50;
    const y = Number.isFinite(Number(position.y)) ? Number(position.y) : 50;

    image.style.width = `${width}px`;
    image.style.height = `${height}px`;
    image.style.left = `${(frame.width - width) * x / 100}px`;
    image.style.top = `${(frame.height - height) * y / 100}px`;
  }

  function refreshCoverFraming() {
    select("#grid").querySelectorAll("[data-cover-image]").forEach((image) => {
      const project = state.projects[Number(image.dataset.coverImage)];
      if (!project) return;
      if (image.complete) {
        applyCoverFraming(image, project);
      } else {
        image.addEventListener("load", () => applyCoverFraming(image, project), { once: true });
      }
    });
  }

  function refreshClotheslines() {
    const grid = select("#grid");
    const cards = Array.from(grid.querySelectorAll(".card"));
    let svg = grid.querySelector(".clotheslines");
    if (!svg) {
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.classList.add("clotheslines");
      svg.setAttribute("aria-hidden", "true");
      grid.insertBefore(svg, grid.firstChild);
    }

    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }
    if (!cards.length) return;

    const gridRect = grid.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const gridHeight = grid.getBoundingClientRect().height;
    if (!viewportWidth || !gridHeight) return;
    svg.setAttribute("viewBox", `0 0 ${viewportWidth} ${gridHeight}`);

    const rows = [];
    cards.forEach((card) => {
      const frame = card.querySelector(".vintage-print");
      if (!frame) return;
      const frameRect = frame.getBoundingClientRect();
      const pinStyle = window.getComputedStyle(frame, "::before");
      const pinTop = Number.parseFloat(pinStyle.top) || 0;
      const pinHeight = Number.parseFloat(pinStyle.height) || 0;
      const frameStyle = window.getComputedStyle(frame);
      const transform = frameStyle.transform === "none"
        ? "matrix(1, 0, 0, 1, 0, 0)"
        : frameStyle.transform;
      const matrix = new DOMMatrixReadOnly(transform);
      const pinCenterY = frameRect.top + frameRect.height / 2
        + matrix.d * (pinTop + pinHeight / 2 - frame.offsetHeight / 2)
        - gridRect.top;
      const cardTop = card.getBoundingClientRect().top;
      let row = rows.find((item) => Math.abs(item.top - cardTop) < 1);
      if (!row) {
        row = { top: cardTop, pins: [] };
        rows.push(row);
      }
      row.pins.push({
        x: frameRect.left + frameRect.width / 2,
        y: pinCenterY,
      });
    });

    rows.forEach((row) => {
      row.pins.sort((first, second) => first.x - second.x);
      if (!row.pins.length) return;

      const points = [
        { x: 0, y: row.pins[0].y },
        ...row.pins,
        { x: viewportWidth, y: row.pins[row.pins.length - 1].y },
      ];
      let pathData = `M ${points[0].x} ${points[0].y}`;
      for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        const controlX = (start.x + end.x) / 2;
        const controlY = (start.y + end.y) / 2 + 7;
        pathData += ` Q ${controlX} ${controlY} ${end.x} ${end.y}`;
      }

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      svg.appendChild(path);
    });
  }

  function projectControls(index) {
    if (!state.admin) {
      return "";
    }

    const project = state.projects[index];
    const imageBlocks = (Array.isArray(project.blocks) ? project.blocks : [])
      .map((block, blockIndex) => ({ block, blockIndex }))
      .filter(({ block }) => block.type === "image" && block.file);
    const coverIndex = imageBlocks.find(({ block }) => block.cover)?.blockIndex
      ?? imageBlocks.find(({ block }) => block.file)?.blockIndex
      ?? "";
    const position = project.coverPosition || { x: 50, y: 50 };
    const positionX = Number.isFinite(Number(position.x)) ? Number(position.x) : 50;
    const positionY = Number.isFinite(Number(position.y)) ? Number(position.y) : 50;
    const zoom = project.coverZoom !== null && project.coverZoom !== undefined
      && Number.isFinite(Number(project.coverZoom))
      ? Math.min(2.5, Math.max(0.5, Number(project.coverZoom)))
      : 1;

    return `
      <div class="project-controls admin-only">
        ${imageBlocks.length ? `
          <select data-project-action="cover" data-index="${index}" aria-label="Choose card image" title="Choose card image">
            ${imageBlocks.map(({ block, blockIndex }) =>
      `<option value="${blockIndex}"${blockIndex === Number(coverIndex) ? " selected" : ""}>${blockIndex + 1}</option>`
    ).join("")}
          </select>
        ` : ""}
        <button type="button" data-project-action="upload-cover" data-index="${index}" aria-label="Upload card image" title="Upload card image">+</button>
        <label class="cover-color" title="Card background color">
          <input type="color" data-cover-color data-index="${index}" value="${escapeHtml(project.coverBg || "#dedbd2")}" aria-label="Card background color">
        </label>
        <button type="button" data-project-action="up" data-index="${index}" aria-label="Move project up">↑</button>
        <button type="button" data-project-action="down" data-index="${index}" aria-label="Move project down">↓</button>
        <button type="button" data-project-action="delete" data-index="${index}" aria-label="Delete project">×</button>
        <label class="range-control">
          <span>Horizontal</span>
          <input type="range" min="0" max="100" step="1" value="${positionX}" data-cover-position="x" data-index="${index}" aria-label="Horizontal image position">
          <output>${positionX}%</output>
        </label>
        <label class="range-control">
          <span>Vertical</span>
          <input type="range" min="0" max="100" step="1" value="${positionY}" data-cover-position="y" data-index="${index}" aria-label="Vertical image position">
          <output>${positionY}%</output>
        </label>
        <label class="range-control">
          <span>Zoom</span>
          <input type="range" min="0.5" max="2.5" step="0.05" value="${zoom}" data-cover-zoom data-index="${index}" aria-label="Cover image zoom">
          <output>${Math.round(zoom * 100)}%</output>
        </label>
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
      const cardCover = state.admin
        ? `<button class="card-cover" type="button" aria-label="Select ${escapeHtml(project.title || "project")} for preview editing">${projectTile(project, index)}</button>`
        : `<a class="card-cover" href="#/p/${index}" aria-label="Open ${escapeHtml(project.title || "project")}">${projectTile(project, index)}</a>`;

      return `
        <article class="card${state.activePreviewEditorIndex === index ? " preview-selected" : ""}" data-index="${index}">
          <div class="vintage-print">
            <div class="project-preview">
              ${cardCover}
            </div>
            ${meta}
          </div>
        </article>
      `;
    }).join("") || '<p class="empty">Selected work will appear here.</p>';

    const workLayout = select(".work-layout");
    const editor = select("#project-editor");
    const activeProject = state.projects[state.activePreviewEditorIndex];
    workLayout.classList.toggle("has-editor", state.admin && state.previewEditorOpen);
    editor.hidden = !state.admin || !state.previewEditorOpen;
    editor.innerHTML = !state.admin || !state.previewEditorOpen
      ? ""
      : activeProject
        ? `
        <div class="project-editor-heading">
          <div>
            <p class="project-editor-kicker">Preview editor</p>
            <h3>${escapeHtml(activeProject.title || "Untitled project")}</h3>
          </div>
          <button type="button" class="project-editor-close" data-project-action="close-editor" aria-label="Close preview editor">×</button>
        </div>
        <a class="project-editor-open" href="#/p/${state.activePreviewEditorIndex}">Edit full project page ↗</a>
        <p class="project-editor-help">Drag to reframe. Position snaps near center; zoom adjusts in 5% steps.</p>
        ${projectControls(state.activePreviewEditorIndex)}
      `
        : `
        <p class="project-editor-kicker">Preview editor</p>
        <p class="project-editor-empty">Select a work preview to edit its card image, color, position and zoom.</p>
      `;
    refreshCoverFraming();
    refreshClotheslines();

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
        <button type="button" class="block-drag" data-block-drag aria-label="Drag media block to reorder" title="Drag to reorder">↕</button>
        ${isMediaBlock(block)
        ? `<div class="media-size-control"><span>Width</span><input type="range" min="1" max="100" step="1" data-block-size data-index="${index}" value="${mediaWidth(block)}" aria-label="Media width"><input type="number" min="1" max="100" step="1" data-block-size-number data-index="${index}" value="${mediaWidth(block)}" aria-label="Media width percentage"><span>%</span></div>`
        : ""}
        ${isMediaBlock(block)
        ? `<div class="media-align-control" role="group" aria-label="Media alignment">
            <button type="button" data-media-align="left" data-index="${index}" class="${block.align === "left" ? "selected" : ""}" aria-label="Align media left" title="Align left">L</button>
            <button type="button" data-media-align="center" data-index="${index}" class="${block.align === "center" ? "selected" : ""}" aria-label="Align media center" title="Align center">C</button>
            <button type="button" data-media-align="right" data-index="${index}" class="${block.align === "right" ? "selected" : ""}" aria-label="Align media right" title="Align right">R</button>
          </div>`
        : ""}
        ${block.type === "image"
        ? `<label class="block-color" title="Image background color"><input type="color" data-block-color data-index="${index}" value="${escapeHtml(block.bg || "#000000")}" aria-label="Image background color"></label>`
        : ""}
        ${isMediaBlock(block)
        ? `<button type="button" data-block-action="replace" data-index="${index}" aria-label="${block.type === "youtube" ? "Edit YouTube URL" : "Replace media"}">${block.type === "youtube" ? "Edit URL" : "Replace"}</button>`
        : ""}
        <button type="button" data-block-action="up" data-index="${index}" aria-label="Move block up">↑</button>
        <button type="button" data-block-action="down" data-index="${index}" aria-label="Move block down">↓</button>
        ${!isMediaBlock(block)
        ? `<button type="button" data-block-action="width" data-index="${index}" aria-label="Toggle block width">↔</button>`
        : ""}
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
    const insertControls = state.admin
      ? `<div class="block-insert-controls">
          <button type="button" class="media-insert" data-media-insert="${index + 1}">+ Media after</button>
          <button type="button" class="media-insert" data-block-insert="divider" data-index="${index + 1}">+ Line after</button>
        </div>`
      : "";
    const editableText = (placeholder) => state.admin
      ? ` contenteditable="true" spellcheck="false" data-block-field="text" data-index="${index}" data-placeholder="${placeholder}"`
      : "";

    if (block.type === "image") {
      if (!source && !state.admin) {
        return "";
      }

      const image = source
        ? `<img src="${escapeHtml(source)}" alt="" style="background:${escapeHtml(block.bg || "transparent")}">`
        : "";
      const media = source
        ? state.admin
          ? image
          : `<button type="button" class="image-viewer-trigger" aria-label="View image larger">${image}</button>`
        : state.admin ? '<div class="media-empty">Choose “Photo / video” to add an image.</div>' : "";
      const dropZones = state.admin
        ? `<div class="media-drop-zones" aria-hidden="true">
            <div class="media-drop-zone" data-media-drop-side="before">Drop media before</div>
            <div class="media-drop-zone" data-media-drop-side="after">Drop media after</div>
          </div>`
        : "";
      return `<figure class="b media-block image-block" data-block="${index}" style="grid-column:${mediaGridStyle(block)}">${controls}<div class="media-canvas">${media}</div>${dropZones}${insertControls}</figure>`;
    }

    if (block.type === "video") {
      if (!source && !state.admin) {
        return "";
      }

      const media = source
        ? `<video src="${escapeHtml(source)}" controls playsinline preload="metadata"></video>`
        : state.admin ? '<div class="media-empty">Choose “Photo / video” to add a video.</div>' : "";
      const dropZones = state.admin
        ? `<div class="media-drop-zones" aria-hidden="true">
            <div class="media-drop-zone" data-media-drop-side="before">Drop media before</div>
            <div class="media-drop-zone" data-media-drop-side="after">Drop media after</div>
          </div>`
        : "";
      return `<figure class="b media-block video-block" data-block="${index}" style="grid-column:${mediaGridStyle(block)}">${controls}<div class="media-canvas">${media}</div>${dropZones}${insertControls}</figure>`;
    }

    if (block.type === "youtube") {
      const embedUrl = youtubeEmbedUrl(block.url);
      const watchUrl = embedUrl
        ? embedUrl.replace("www.youtube-nocookie.com/embed/", "www.youtube.com/watch?v=")
        : "";
      const media = embedUrl
        ? location.protocol === "file:"
          ? '<div class="youtube-local-notice">YouTube previews need a hosted page. Open the link below while viewing this local copy.</div>'
          : `<iframe class="youtube-player" src="${escapeHtml(embedUrl)}" title="YouTube video player" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`
        : state.admin ? '<div class="media-empty">Add a valid YouTube link.</div>' : "";
      const dropZones = state.admin
        ? `<div class="media-drop-zones" aria-hidden="true">
            <div class="media-drop-zone" data-media-drop-side="before">Drop media before</div>
            <div class="media-drop-zone" data-media-drop-side="after">Drop media after</div>
          </div>`
        : "";
      if (!embedUrl && !state.admin) return "";
      const watchLink = watchUrl
        ? `<a class="youtube-watch-link" href="${escapeHtml(watchUrl)}" target="_blank" rel="noopener noreferrer">Watch on YouTube ↗</a>`
        : "";
      return `<figure class="b media-block youtube-block" data-block="${index}" style="grid-column:${mediaGridStyle(block)}">${controls}<div class="media-canvas"><div class="${location.protocol === "file:" ? "youtube-local-frame" : "youtube-frame"}">${media}</div>${watchLink}</div>${dropZones}${insertControls}</figure>`;
    }

    if (block.type === "divider") {
      return `<div class="b divider${widthClass}" data-block="${index}">${controls}<span class="divider-rule" role="separator" aria-label="Section separator"></span>${insertControls}</div>`;
    }

    if (block.type === "heading") {
      if (!String(block.text || "").trim() && !state.admin) {
        return "";
      }

      return `
        <div class="b t h" data-block="${index}">
          ${controls}
          <div class="block-content"${editableText("Heading")}>${escapeHtml(block.text)}</div>
          ${insertControls}
        </div>
      `;
    }

    if (block.type === "text") {
      if (!String(block.text || "").trim() && !state.admin) {
        return "";
      }

      return `
        <div class="b t${widthClass}" data-block="${index}">
          ${controls}
          <div class="block-content"${editableText("Text")}>${escapeHtml(block.text)}</div>
          ${insertControls}
        </div>
      `;
    }

    return "";
  }

  function renderProject(project) {
    const blocks = Array.isArray(project.blocks) ? project.blocks : [];
    const renderedBlocks = blocks.map(blockHtml).join("");
    const mediaHint = state.admin && blocks.some(isMediaBlock)
      ? '<p class="image-placement-hint">Drag media with its ↕ handle. Use the separate boxes below a media block to position it; type a width or use the slider.</p>'
      : "";
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
      <div class="project-rule" aria-hidden="true"></div>
      ${state.admin ? `
        <div class="block-insert-controls media-insert-start">
          <button type="button" class="media-insert" data-media-insert="0">+ Media at start</button>
          <button type="button" class="media-insert" data-block-insert="divider" data-index="0">+ Line at start</button>
        </div>
      ` : ""}
      ${mediaHint}
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
    if (await restoreEditorSession()) {
      routePage();
      return;
    }

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

  function openEditorDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(editorDatabaseName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("handles");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open editor storage."));
    });
  }

  async function storeProjectFolder(folder) {
    const database = await openEditorDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("handles", "readwrite");
        transaction.objectStore("handles").put(folder, "projectFolder");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error("Could not store the portfolio folder."));
        transaction.onabort = () => reject(transaction.error || new Error("Could not store the portfolio folder."));
      });
    } finally {
      database.close();
    }
  }

  async function getStoredProjectFolder() {
    const database = await openEditorDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction("handles", "readonly");
        const request = transaction.objectStore("handles").get("projectFolder");
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error("Could not read the saved portfolio folder."));
      });
    } finally {
      database.close();
    }
  }

  async function readProjectsFromFolder(folder) {
    await folder.getFileHandle("index.html");
    const content = await folder.getDirectoryHandle("content");
    const fileHandle = await content.getFileHandle("projects.json");
    const file = await fileHandle.getFile();
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.projects)) {
      throw new Error("content/projects.json is not a valid project list.");
    }
    return data.projects;
  }

  async function restoreEditorSession() {
    if (sessionStorage.getItem(editorSessionKey) !== "true") {
      return false;
    }

    try {
      const folder = await getStoredProjectFolder();
      if (!folder) {
        throw new Error("The saved portfolio folder is unavailable.");
      }

      const permission = await folder.queryPermission({ mode: "readwrite" });
      if (permission !== "granted") {
        sessionStorage.removeItem(editorSessionKey);
        showToast("The local editor needs folder access again. Click the logo five times and choose your portfolio folder.");
        return false;
      }

      state.projectFolder = folder;
      state.projects = await readProjectsFromFolder(folder);
      state.admin = true;
      state.dirty = false;
      select("#admin-status").textContent = "Local editor restored";
      return true;
    } catch (error) {
      console.error("Could not restore the local editor:", error);
      sessionStorage.removeItem(editorSessionKey);
      showToast(`Could not restore the local editor: ${error.message}`);
      return false;
    }
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
      const projects = await readProjectsFromFolder(folder);

      state.projectFolder = folder;
      state.projects = projects;
      state.admin = true;
      state.dirty = false;
      let recoveryWarning = "";
      try {
        await storeProjectFolder(folder);
        sessionStorage.setItem(editorSessionKey, "true");
      } catch (error) {
        console.error("Could not save local editor recovery data:", error);
        recoveryWarning = `Edit mode is on, but it cannot be restored after a page reload: ${error.message}`;
      }
      select("#admin-status").textContent = "Local editor ready";
      routePage();
      showToast(recoveryWarning || "Edit mode on. Changes appear directly on the page.");
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

  function addYouTubeBlock() {
    const project = currentProject();
    if (!state.admin || !project) {
      showToast("Open a project before adding a YouTube video.");
      return;
    }

    const url = window.prompt("Paste a YouTube video link.");
    if (url === null) return;
    if (!youtubeEmbedUrl(url)) {
      showToast("Enter a valid YouTube video link.");
      return;
    }

    const blocks = ensureProjectBlocks(project);
    blocks.push({ type: "youtube", url: url.trim(), w: "full", width: 100 });
    markDirty();
    drawPage();
    select(`#proj .b[data-block="${blocks.length - 1}"]`)?.scrollIntoView({ block: "center" });
  }

  function addDivider(index) {
    const project = currentProject();
    if (!state.admin || !project) {
      showToast("Open a project first.");
      return;
    }

    const blocks = ensureProjectBlocks(project);
    const insertAt = Number.isInteger(index)
      ? Math.min(Math.max(index, 0), blocks.length)
      : blocks.length;
    blocks.splice(insertAt, 0, { type: "divider", w: "full" });
    markDirty();
    drawPage();
    const divider = select(`#proj [data-block="${insertAt}"]`);
    if (divider) {
      divider.scrollIntoView({ block: "center" });
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
    if (file.size > 95 * 1024 * 1024) {
      throw new Error("Keep uploads under 95 MiB; GitHub rejects files over 100 MiB.");
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
    const editorContext = state.mediaEditorContext;
    restoreMediaEditorContext(editorContext);
    const mediaProjectIndex = state.mediaProjectIndex;
    const mediaInsertIndex = state.mediaInsertIndex;
    const project = Number.isInteger(mediaProjectIndex)
      ? state.projects[mediaProjectIndex]
      : currentProject();
    if (!state.admin || !project) {
      state.replaceBlockIndex = null;
      state.mediaProjectIndex = null;
      state.mediaInsertIndex = null;
      state.mediaEditorContext = null;
      showToast("Open a project before adding media.");
      return;
    }

    const blocks = ensureProjectBlocks(project);
    const fileList = Array.from(files);
    const scrollTop = window.scrollY;
    let added = 0;
    let insertedCount = 0;
    try {
      for (const file of fileList) {
        const block = await storeMedia(file);
        if (Number.isInteger(mediaProjectIndex) && block.type === "image") {
          project.coverFile = block.file;
          state.coverPreviews.set(project, URL.createObjectURL(file));
          added += 1;
          markDirty();
          continue;
        }
        const replaceIndex = state.replaceBlockIndex;
        let visibleBlock = block;
        if (replaceIndex !== null && fileList.length === 1) {
          const previousBlock = blocks[replaceIndex];
          if (previousBlock) {
            releaseMediaPreview(previousBlock);
          }
          visibleBlock = { ...previousBlock, ...block };
          blocks[replaceIndex] = visibleBlock;
        } else if (Number.isInteger(mediaInsertIndex)) {
          blocks.splice(Math.min(mediaInsertIndex + insertedCount, blocks.length), 0, visibleBlock);
          insertedCount += 1;
        } else {
          blocks.push(visibleBlock);
        }
        state.mediaPreviews.set(visibleBlock, URL.createObjectURL(file));
        added += 1;
        markDirty();
      }

      if (added) {
        restoreMediaEditorContext(editorContext);
        state.replaceBlockIndex = null;
        state.mediaProjectIndex = null;
        state.mediaInsertIndex = null;
        state.mediaEditorContext = null;
        drawPage();
        window.scrollTo(0, scrollTop);
        await saveProjects();
        showToast(`${added} media file${added === 1 ? "" : "s"} added and saved.`);
      }
    } catch (error) {
      console.error("Could not add project media:", error);
      restoreMediaEditorContext(editorContext);
      state.replaceBlockIndex = null;
      state.mediaProjectIndex = null;
      state.mediaInsertIndex = null;
      state.mediaEditorContext = null;
      if (added) {
        drawPage();
        window.scrollTo(0, scrollTop);
      } else {
        drawPage();
      }
      showToast(error.message || "Media upload failed.");
    }
  }

  function openMediaPicker(replaceIndex, projectIndex, insertIndex) {
    state.mediaProjectIndex = Number.isInteger(projectIndex) ? projectIndex : null;
    state.mediaInsertIndex = Number.isInteger(insertIndex) ? insertIndex : null;

    if (!Number.isInteger(projectIndex) && !currentProject()) {
      if (state.projects.length !== 1) {
        state.replaceBlockIndex = null;
        state.mediaProjectIndex = null;
        state.mediaInsertIndex = null;
        state.mediaEditorContext = null;
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
    state.mediaEditorContext = {
      admin: state.admin,
      projectIndex: state.projectIndex,
      hash: location.hash,
    };
    select("#media-file").click();
  }

  function restoreMediaEditorContext(context) {
    if (!context || !context.admin) {
      return;
    }

    state.admin = true;
    state.projectIndex = context.projectIndex;
    if (location.hash !== context.hash) {
      location.hash = context.hash;
    }
  }

  async function deleteProject(index) {
    const project = state.projects[index];
    if (!project || !window.confirm(`Delete "${project.title || "Untitled project"}"?`)) {
      return;
    }

    (Array.isArray(project.blocks) ? project.blocks : []).forEach(releaseMediaPreview);
    state.projects.splice(index, 1);
    if (state.activePreviewEditorIndex === index) {
      state.activePreviewEditorIndex = null;
    } else if (state.activePreviewEditorIndex !== null && state.activePreviewEditorIndex > index) {
      state.activePreviewEditorIndex -= 1;
    }
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
    const button = event.target.closest("button[data-project-action]");
    if (!button || !state.admin) {
      return false;
    }

    event.preventDefault();
    const index = Number(button.dataset.index);
    const action = button.dataset.projectAction;

    if (action === "close-editor") {
      state.activePreviewEditorIndex = null;
      state.previewEditorOpen = false;
      renderHome();
      return true;
    }

    if (action === "upload-cover") {
      state.replaceBlockIndex = null;
      openMediaPicker(null, index);
      return true;
    }

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
    state.activePreviewEditorIndex = nextIndex;
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
      if (block.type === "youtube") {
        const url = window.prompt("Paste a YouTube video link.", block.url || "");
        if (url === null) return true;
        if (!youtubeEmbedUrl(url)) {
          showToast("Enter a valid YouTube video link.");
          return true;
        }
        block.url = url.trim();
        markDirty();
        drawPage();
        return true;
      }
      openMediaPicker(index);
      return true;
    }

    if (action === "remove") {
      releaseMediaPreview(block);
      if (project.coverFile === block.file) {
        project.coverFile = "";
      }
      project.blocks.splice(index, 1);
    } else if (action === "cover") {
      project.blocks.forEach((item) => {
        if (item.type === "image") {
          item.cover = false;
        }
      });
      block.cover = true;
      project.coverFile = block.file;
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
  window.addEventListener("resize", () => {
    refreshCoverFraming();
    refreshClotheslines();
  });

  select("#grid").addEventListener("click", (event) => {
    if (suppressCoverClick) {
      event.preventDefault();
      suppressCoverClick = false;
      return;
    }

    const cover = event.target.closest(".card-cover");
    if (state.admin && cover) {
      event.preventDefault();
      state.activePreviewEditorIndex = Number(cover.closest(".card").dataset.index);
      state.previewEditorOpen = true;
      renderHome();
      return;
    }

    if (state.admin && event.target.closest("[contenteditable]")) {
      event.stopPropagation();
    }
  });

  select("#grid").addEventListener("pointerdown", (event) => {
    if (!state.admin || event.button !== 0) return;

    const image = event.target.closest("[data-cover-image]");
    const card = image && image.closest(".card[data-index]");
    if (!image || !card) return;

    const index = Number(card.dataset.index);
    if (index !== state.activePreviewEditorIndex) return;

    const project = state.projects[index];
    const frame = image.parentElement.getBoundingClientRect();
    if (!project || !image.naturalWidth || !frame.width || !frame.height) return;

    const position = project.coverPosition || { x: 50, y: 50 };
    coverPointerDrag = {
      image,
      index,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: Number.isFinite(Number(position.x)) ? Number(position.x) : 50,
      baseY: Number.isFinite(Number(position.y)) ? Number(position.y) : 50,
      overflowX: image.clientWidth - frame.width,
      overflowY: image.clientHeight - frame.height,
      moved: false,
    };
    image.setPointerCapture(event.pointerId);
    image.classList.add("is-cropping");
    event.preventDefault();
  });

  select("#grid").addEventListener("pointermove", (event) => {
    const drag = coverPointerDrag;
    if (!state.admin || !drag || event.pointerId !== drag.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) drag.moved = true;

    const project = state.projects[drag.index];
    if (!project) return;
    project.coverPosition = project.coverPosition || { x: 50, y: 50 };
    project.coverPosition.x = drag.overflowX
      ? Math.min(100, Math.max(0, drag.baseX - deltaX * 100 / drag.overflowX))
      : drag.baseX;
    project.coverPosition.y = drag.overflowY
      ? Math.min(100, Math.max(0, drag.baseY - deltaY * 100 / drag.overflowY))
      : drag.baseY;

    applyCoverFraming(drag.image, project);
    ["x", "y"].forEach((axis) => {
      const input = select(`#project-editor [data-cover-position="${axis}"]`);
      if (input) {
        const value = Math.round(project.coverPosition[axis]);
        input.value = String(value);
        input.closest(".range-control").querySelector("output").textContent = `${value}%`;
      }
    });
    markDirty();
  });

  select("#grid").addEventListener("pointerup", (event) => {
    const drag = coverPointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const project = state.projects[drag.index];
    if (project) {
      project.coverPosition = project.coverPosition || { x: 50, y: 50 };
      ["x", "y"].forEach((axis) => {
        const positionValue = Number(project.coverPosition[axis]);
        const value = Number.isFinite(positionValue) ? Math.round(positionValue) : 50;
        const snapPoint = [0, 50, 100].find((point) => Math.abs(point - value) <= 2);
        project.coverPosition[axis] = snapPoint === undefined ? value : snapPoint;
      });
      applyCoverFraming(drag.image, project);
      ["x", "y"].forEach((axis) => {
        const input = select(`#project-editor [data-cover-position="${axis}"]`);
        if (input) {
          const value = project.coverPosition[axis];
          input.value = String(value);
          input.closest(".range-control").querySelector("output").textContent = `${value}%`;
        }
      });
    }

    if (drag.moved) {
      suppressCoverClick = true;
      window.setTimeout(() => {
        suppressCoverClick = false;
      }, 0);
    }
    drag.image.classList.remove("is-cropping");
    if (drag.image.hasPointerCapture(event.pointerId)) {
      drag.image.releasePointerCapture(event.pointerId);
    }
    coverPointerDrag = null;
  });

  select("#grid").addEventListener("pointercancel", (event) => {
    if (!coverPointerDrag || event.pointerId !== coverPointerDrag.pointerId) return;
    coverPointerDrag.image.classList.remove("is-cropping");
    coverPointerDrag = null;
  });

  select("#project-editor").addEventListener("click", (event) => {
    handleProjectControls(event);
  });

  select("#project-editor").addEventListener("input", (event) => {
    if (!state.admin
      || !event.target.matches("[data-cover-position], [data-cover-zoom]")) return;

    const index = Number(event.target.dataset.index);
    const project = state.projects[index];
    if (!project) return;

    const output = event.target.closest(".range-control").querySelector("output");
    const image = select(`#grid .card[data-index="${index}"] .cover-media img`);
    if (event.target.matches("[data-cover-position]")) {
      project.coverPosition = project.coverPosition || { x: 50, y: 50 };
      project.coverPosition[event.target.dataset.coverPosition] = Number(event.target.value);
      output.value = `${event.target.value}%`;
      output.textContent = output.value;
      if (image) {
        applyCoverFraming(image, project);
      }
    } else {
      project.coverZoom = Number(event.target.value);
      output.value = `${Math.round(project.coverZoom * 100)}%`;
      output.textContent = output.value;
      if (image) {
        applyCoverFraming(image, project);
      }
    }
    markDirty();
  });

  select("#project-editor").addEventListener("change", (event) => {
    if (!state.admin) return;

    if (event.target.matches("[data-project-action=\"cover\"]")) {
      const project = state.projects[Number(event.target.dataset.index)];
      const blockIndex = Number(event.target.value);
      if (project) {
        (project.blocks || []).forEach((block) => {
          if (block.type === "image") block.cover = false;
        });
        const block = project.blocks[blockIndex];
        if (block) block.cover = true;
        project.coverFile = block && block.file ? block.file : "";
        markDirty();
        renderHome();
      }
    }

    if (event.target.matches("[data-cover-color]")) {
      const project = state.projects[Number(event.target.dataset.index)];
      if (project) {
        project.coverBg = event.target.value;
        markDirty();
        renderHome();
      }
    }

  });

  select("#proj").addEventListener("click", (event) => {
    const imageTrigger = event.target.closest(".image-viewer-trigger");
    if (imageTrigger) {
      const image = imageTrigger.querySelector("img");
      const lightbox = select("#image-lightbox");
      const lightboxImage = select("#image-lightbox-image");
      if (image && lightbox && lightboxImage) {
        lightboxImage.src = image.currentSrc || image.src;
        lightboxImage.alt = image.alt;
        lightbox.showModal();
      }
      return;
    }

    const alignmentButton = event.target.closest("[data-media-align]");
    if (alignmentButton && state.admin) {
      event.preventDefault();
      const project = currentProject();
      const block = project && project.blocks[Number(alignmentButton.dataset.index)];
      const alignment = alignmentButton.dataset.mediaAlign;
      if (isMediaBlock(block) && ["left", "center", "right"].includes(alignment)) {
        block.align = alignment;
        markDirty();
        drawPage();
      }
      return;
    }

    const lineButton = event.target.closest("[data-block-insert='divider']");
    if (lineButton && state.admin) {
      event.preventDefault();
      addDivider(Number(lineButton.dataset.index));
      return;
    }

    const insertButton = event.target.closest("[data-media-insert]");
    if (insertButton && state.admin) {
      event.preventDefault();
      openMediaPicker(null, null, Number(insertButton.dataset.mediaInsert));
      return;
    }

    handleBlockControls(event);
  });

  select("#image-lightbox").addEventListener("click", (event) => {
    if (event.target === event.currentTarget || event.target.closest("[data-lightbox-close]")) {
      event.currentTarget.close();
    }
  });

  function placeBlock(from, target, clientY, side) {
    const project = currentProject();
    const targetElement = Number.isInteger(target)
      ? select(`#proj .b[data-block="${target}"]`)
      : null;
    if (!project || !targetElement) {
      return;
    }

    const block = project.blocks[from];
    const targetBlock = project.blocks[target];
    if (!block || !targetBlock) {
      return;
    }

    const pairMedia = from !== target
      && isMediaBlock(block)
      && isMediaBlock(targetBlock);
    const bounds = targetElement.getBoundingClientRect();
    let insertAt = target + (side
      ? side === "after" ? 1 : 0
      : clientY < bounds.top + bounds.height / 2 ? 0 : 1);
    const staysInPlace = from === insertAt || from + 1 === insertAt;
    let changed = false;

    if (staysInPlace) {
      if (pairMedia) changed = pairMediaBlocks(project, block, targetBlock) || changed;
    } else {
      project.blocks.splice(from, 1);
      if (from < insertAt) {
        insertAt -= 1;
      }
      project.blocks.splice(insertAt, 0, block);
      changed = true;
      if (pairMedia) changed = pairMediaBlocks(project, block, targetBlock) || changed;
    }

    if (changed) {
      markDirty();
      drawPage();
    }
  }

  function clearBlockDropTargets() {
    select("#proj").querySelectorAll(".drop-before, .drop-after").forEach((block) => {
      block.classList.remove("drop-before", "drop-after");
    });
    select("#proj").querySelectorAll(".media-drop-zone.is-target").forEach((zone) => {
      zone.classList.remove("is-target");
    });
  }

  function finishBlockPointerDrag(drag) {
    if (drag.handle.hasPointerCapture(drag.pointerId)) {
      drag.handle.releasePointerCapture(drag.pointerId);
    }
    drag.handle.closest(".b[data-block]")?.classList.remove("is-dragging");
    state.blockPointerDrag = null;
    state.draggedBlockIndex = null;
    document.body.classList.remove("media-dragging");
    clearBlockDropTargets();
  }

  select("#proj").addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-block-drag]");
    const block = handle && handle.closest(".b[data-block]");
    if (!state.admin || event.button !== 0 || !block) return;

    event.preventDefault();
    state.draggedBlockIndex = Number(block.dataset.block);
    state.blockPointerDrag = {
      from: state.draggedBlockIndex,
      handle,
      pointerId: event.pointerId,
    };
    handle.setPointerCapture(event.pointerId);
    const draggedBlock = currentProject()?.blocks[state.draggedBlockIndex];
    document.body.classList.toggle("media-dragging", isMediaBlock(draggedBlock));
    block.classList.add("is-dragging");
  });

  document.addEventListener("pointermove", (event) => {
    const drag = state.blockPointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const hovered = document.elementFromPoint(event.clientX, event.clientY);
    const dropZone = hovered && hovered.closest("[data-media-drop-side]");
    const target = dropZone
      ? dropZone.closest(".b[data-block]")
      : hovered && hovered.closest(".b[data-block]");
    if (!target || dropZone && !isMediaBlock(currentProject()?.blocks[drag.from])) {
      clearBlockDropTargets();
      return;
    }

    event.preventDefault();
    clearBlockDropTargets();

    if (dropZone) {
      dropZone.classList.add("is-target");
    } else {
      const bounds = target.getBoundingClientRect();
      target.classList.add(event.clientY < bounds.top + bounds.height / 2
        ? "drop-before"
        : "drop-after");
    }
  });

  document.addEventListener("pointerup", (event) => {
    const drag = state.blockPointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const hovered = document.elementFromPoint(event.clientX, event.clientY);
    const dropZone = hovered && hovered.closest("[data-media-drop-side]");
    const target = dropZone
      ? dropZone.closest(".b[data-block]")
      : hovered && hovered.closest(".b[data-block]");
    const canDrop = target && (!dropZone || isMediaBlock(currentProject()?.blocks[drag.from]));
    const targetIndex = canDrop ? Number(target.dataset.block) : null;
    const side = dropZone && dropZone.dataset.mediaDropSide;
    finishBlockPointerDrag(drag);
    if (canDrop) {
      placeBlock(drag.from, targetIndex, event.clientY, side);
    }
  });

  document.addEventListener("pointercancel", (event) => {
    const drag = state.blockPointerDrag;
    if (drag && event.pointerId === drag.pointerId) {
      finishBlockPointerDrag(drag);
    }
  });

  select("#proj").addEventListener("input", (event) => {
    if (!state.admin || !event.target.matches("[data-block-size]")) return;

    const project = currentProject();
    const block = project && project.blocks[Number(event.target.dataset.index)];
    if (!block) return;

    applyMediaWidthControl(event.target, block, event.target.value);
  });

  select("#proj").addEventListener("change", (event) => {
    if (!state.admin) return;

    if (event.target.matches("[data-block-size-number]")) {
      const project = currentProject();
      const block = project && project.blocks[Number(event.target.dataset.index)];
      if (block) {
        applyMediaWidthControl(event.target, block, event.target.value);
      }
      return;
    }

    if (!event.target.matches("[data-block-color]")) return;
    const project = currentProject();
    const block = project && project.blocks[Number(event.target.dataset.index)];
    if (block) {
      block.bg = event.target.value;
      markDirty();
      drawPage();
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.matches("[contenteditable]")) {
      updateEditedContent(event.target);
      refreshClotheslines();
    }
  });

  document.addEventListener("keydown", (event) => {
    const lightbox = select("#image-lightbox");
    if (event.key === "Escape" && lightbox.open) {
      event.preventDefault();
      lightbox.close();
    }

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
    } else if (action === "youtube") {
      addYouTubeBlock();
    } else if (action === "heading" || action === "text") {
      addTextBlock(action);
    } else if (action === "line") {
      addDivider();
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
      sessionStorage.removeItem(editorSessionKey);
      drawPage();
      showToast("Edit mode off.");
    }
  });

  select("#media-file").addEventListener("change", function () {
    const files = Array.from(this.files);
    this.value = "";
    if (!files.length) {
      state.replaceBlockIndex = null;
      state.mediaProjectIndex = null;
      state.mediaInsertIndex = null;
      state.mediaEditorContext = null;
      return;
    }
    addMedia(files);
  });

  loadProjects().catch((error) => {
    console.error("Could not load portfolio projects:", error);
    select("#grid").innerHTML = '<p class="empty" role="alert">Could not load projects. Refresh the page and try again.</p>';
  });
})();
(function () {
  "use strict";

  const select = (selector) => document.querySelector(selector);
  const artworkColors = ["#93dc5d", "#b6e893", "#ddf3c9", "#c4f651"];
  const localCopy = location.protocol === "file:"
    || location.hostname === "localhost"
    || location.hostname === "127.0.0.1";
  const editorSessionKey = "seppe-portfolio-editor-active";
  const editorDatabaseName = "seppe-portfolio-local-editor";
  const state = {
    projects: [],
    projectFolder: null,
    projectIndex: null,
    admin: false,
    dirty: false,
    replaceBlockIndex: null,
    mediaPreviews: new WeakMap(),
    coverPreviews: new WeakMap(),
    mediaProjectIndex: null,
    mediaInsertIndex: null,
    mediaEditorContext: null,
    draggedBlockIndex: null,
    blockPointerDrag: null,
    activePreviewEditorIndex: null,
    previewEditorOpen: false,
  };
  let coverPointerDrag = null;
  let suppressCoverClick = false;

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

  function mediaWidth(block) {
    const width = Number(block.width);
    if (Number.isFinite(width) && width >= 1 && width <= 100) {
      return Math.round(width);
    }
    return block.w === "half" ? 50 : 100;
  }

  function setMediaWidth(block, width) {
    block.width = width;
    block.w = width === 50 ? "half" : "full";
  }

  function pairMediaBlocks(project, block, targetBlock) {
    const blockIndex = project.blocks.indexOf(block);
    const targetIndex = project.blocks.indexOf(targetBlock);
    if (blockIndex < 0 || Math.abs(blockIndex - targetIndex) !== 1) {
      return false;
    }

    const first = project.blocks[Math.min(blockIndex, targetIndex)];
    const second = project.blocks[Math.max(blockIndex, targetIndex)];
    let changed = false;
    if (mediaWidth(first) !== 50 || first.w !== "half") {
      setMediaWidth(first, 50);
      changed = true;
    }
    if (mediaWidth(second) !== 50 || second.w !== "half") {
      setMediaWidth(second, 50);
      changed = true;
    }
    if (first.align !== "left" || second.align !== "right") {
      first.align = "left";
      second.align = "right";
      changed = true;
    }

    return changed;
  }

  function applyMediaWidthControl(control, block, value) {
    const parsedWidth = Number(value);
    const width = Number.isFinite(parsedWidth)
      ? Math.min(100, Math.max(1, Math.round(parsedWidth)))
      : mediaWidth(block);
    const controls = control.closest(".media-size-control");

    setMediaWidth(block, width);
    controls.querySelector("[data-block-size]").value = String(width);
    controls.querySelector("[data-block-size-number]").value = String(width);
    control.closest(".media-block").style.gridColumn = mediaGridStyle(block);
    markDirty();
  }

  function mediaGridStyle(block) {
    const width = mediaWidth(block);
    if (!["left", "center", "right"].includes(block.align)) {
      return `span ${width}`;
    }

    const start = block.align === "left"
      ? 1
      : block.align === "right"
        ? 101 - width
        : Math.floor((100 - width) / 2) + 1;
    return `${start} / span ${width}`;
  }

  function isMediaBlock(block) {
    return block && ["image", "video", "youtube"].includes(block.type);
  }

  function youtubeEmbedUrl(value) {
    try {
      const url = new URL(String(value).trim());
      if (!["http:", "https:"].includes(url.protocol)) return "";

      const host = url.hostname.toLowerCase();
      let videoId = "";
      if (host === "youtu.be") {
        videoId = url.pathname.split("/")[1] || "";
      } else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) {
        videoId = url.searchParams.get("v")
          || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1]
          || "";
      }

      return /^[A-Za-z0-9_-]{11}$/.test(videoId)
        ? `https://www.youtube-nocookie.com/embed/${videoId}`
        : "";
    } catch (error) {
      return "";
    }
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
    if (project.coverFile) {
      return { file: project.coverFile };
    }
    const blocks = Array.isArray(project.blocks) ? project.blocks : [];
    return blocks.find((block) => block.type === "image" && block.cover && block.file)
      || blocks.find((block) => block.type === "image" && block.file);
  }

  function projectTile(project, index) {
    const cover = coverFor(project);
    const source = cover
      ? project.coverFile
        ? state.coverPreviews.get(project) || getMediaUrl(project.coverFile)
        : state.mediaPreviews.get(cover) || getMediaUrl(cover.file)
      : "";
    const coverBackground = String(project.coverBg || "").trim();

    if (source) {
      return `<div class="m cover-media" style="--cover-bg:${escapeHtml(coverBackground || "#dedbd2")}"><img src="${escapeHtml(source)}" alt="${escapeHtml(project.title)}" data-cover-image="${index}"></div>`;
    }

    const color = artworkColors[index % artworkColors.length];
    return `<div class="m art" style="--art-color:${color}">${escapeHtml(project.title)}</div>`;
  }

  function applyCoverFraming(image, project) {
    if (!image.naturalWidth || !image.naturalHeight) return;

    const frame = image.parentElement.getBoundingClientRect();
    if (!frame.width || !frame.height) return;

    const scale = Math.max(frame.width / image.naturalWidth, frame.height / image.naturalHeight);
    const zoomValue = Number(project.coverZoom);
    const zoom = project.coverZoom !== null && project.coverZoom !== undefined
      && Number.isFinite(zoomValue)
      ? Math.min(2.5, Math.max(0.5, zoomValue))
      : 1;
    const width = image.naturalWidth * scale * zoom;
    const height = image.naturalHeight * scale * zoom;
    const position = project.coverPosition || { x: 50, y: 50 };
    const x = Number.isFinite(Number(position.x)) ? Number(position.x) : 50;
    const y = Number.isFinite(Number(position.y)) ? Number(position.y) : 50;

    image.style.width = `${width}px`;
    image.style.height = `${height}px`;
    image.style.left = `${(frame.width - width) * x / 100}px`;
    image.style.top = `${(frame.height - height) * y / 100}px`;
  }

  function refreshCoverFraming() {
    select("#grid").querySelectorAll("[data-cover-image]").forEach((image) => {
      const project = state.projects[Number(image.dataset.coverImage)];
      if (!project) return;
      if (image.complete) {
        applyCoverFraming(image, project);
      } else {
        image.addEventListener("load", () => applyCoverFraming(image, project), { once: true });
      }
    });
  }

  function refreshClotheslines() {
    const grid = select("#grid");
    const cards = Array.from(grid.querySelectorAll(".card"));
    let svg = grid.querySelector(".clotheslines");
    if (!svg) {
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.classList.add("clotheslines");
      svg.setAttribute("aria-hidden", "true");
      grid.insertBefore(svg, grid.firstChild);
    }

    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }
    if (!cards.length) return;

    const gridRect = grid.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const gridHeight = grid.getBoundingClientRect().height;
    if (!viewportWidth || !gridHeight) return;
    svg.setAttribute("viewBox", `0 0 ${viewportWidth} ${gridHeight}`);

    const rows = [];
    cards.forEach((card) => {
      const frame = card.querySelector(".vintage-print");
      if (!frame) return;
      const frameRect = frame.getBoundingClientRect();
      const pinStyle = window.getComputedStyle(frame, "::before");
      const pinTop = Number.parseFloat(pinStyle.top) || 0;
      const pinHeight = Number.parseFloat(pinStyle.height) || 0;
      const frameStyle = window.getComputedStyle(frame);
      const transform = frameStyle.transform === "none"
        ? "matrix(1, 0, 0, 1, 0, 0)"
        : frameStyle.transform;
      const matrix = new DOMMatrixReadOnly(transform);
      const pinCenterY = frameRect.top + frameRect.height / 2
        + matrix.d * (pinTop + pinHeight / 2 - frame.offsetHeight / 2)
        - gridRect.top;
      const cardTop = card.getBoundingClientRect().top;
      let row = rows.find((item) => Math.abs(item.top - cardTop) < 1);
      if (!row) {
        row = { top: cardTop, pins: [] };
        rows.push(row);
      }
      row.pins.push({
        x: frameRect.left + frameRect.width / 2,
        y: pinCenterY,
      });
    });

    rows.forEach((row) => {
      row.pins.sort((first, second) => first.x - second.x);
      if (!row.pins.length) return;

      const points = [
        { x: 0, y: row.pins[0].y },
        ...row.pins,
        { x: viewportWidth, y: row.pins[row.pins.length - 1].y },
      ];
      let pathData = `M ${points[0].x} ${points[0].y}`;
      for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        const controlX = (start.x + end.x) / 2;
        const controlY = (start.y + end.y) / 2 + 7;
        pathData += ` Q ${controlX} ${controlY} ${end.x} ${end.y}`;
      }

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      svg.appendChild(path);
    });
  }

  function projectControls(index) {
    if (!state.admin) {
      return "";
    }

    const project = state.projects[index];
    const imageBlocks = (Array.isArray(project.blocks) ? project.blocks : [])
      .map((block, blockIndex) => ({ block, blockIndex }))
      .filter(({ block }) => block.type === "image" && block.file);
    const coverIndex = imageBlocks.find(({ block }) => block.cover)?.blockIndex
      ?? imageBlocks.find(({ block }) => block.file)?.blockIndex
      ?? "";
    const position = project.coverPosition || { x: 50, y: 50 };
    const positionX = Number.isFinite(Number(position.x)) ? Number(position.x) : 50;
    const positionY = Number.isFinite(Number(position.y)) ? Number(position.y) : 50;
    const zoom = project.coverZoom !== null && project.coverZoom !== undefined
      && Number.isFinite(Number(project.coverZoom))
      ? Math.min(2.5, Math.max(0.5, Number(project.coverZoom)))
      : 1;

    return `
      <div class="project-controls admin-only">
        ${imageBlocks.length ? `
          <select data-project-action="cover" data-index="${index}" aria-label="Choose card image" title="Choose card image">
            ${imageBlocks.map(({ block, blockIndex }) =>
      `<option value="${blockIndex}"${blockIndex === Number(coverIndex) ? " selected" : ""}>${blockIndex + 1}</option>`
    ).join("")}
          </select>
        ` : ""}
        <button type="button" data-project-action="upload-cover" data-index="${index}" aria-label="Upload card image" title="Upload card image">+</button>
        <label class="cover-color" title="Card background color">
          <input type="color" data-cover-color data-index="${index}" value="${escapeHtml(project.coverBg || "#dedbd2")}" aria-label="Card background color">
        </label>
        <button type="button" data-project-action="up" data-index="${index}" aria-label="Move project up">↑</button>
        <button type="button" data-project-action="down" data-index="${index}" aria-label="Move project down">↓</button>
        <button type="button" data-project-action="delete" data-index="${index}" aria-label="Delete project">×</button>
        <label class="range-control">
          <span>Horizontal</span>
          <input type="range" min="0" max="100" step="1" value="${positionX}" data-cover-position="x" data-index="${index}" aria-label="Horizontal image position">
          <output>${positionX}%</output>
        </label>
        <label class="range-control">
          <span>Vertical</span>
          <input type="range" min="0" max="100" step="1" value="${positionY}" data-cover-position="y" data-index="${index}" aria-label="Vertical image position">
          <output>${positionY}%</output>
        </label>
        <label class="range-control">
          <span>Zoom</span>
          <input type="range" min="0.5" max="2.5" step="0.05" value="${zoom}" data-cover-zoom data-index="${index}" aria-label="Cover image zoom">
          <output>${Math.round(zoom * 100)}%</output>
        </label>
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
      const cardCover = state.admin
        ? `<button class="card-cover" type="button" aria-label="Select ${escapeHtml(project.title || "project")} for preview editing">${projectTile(project, index)}</button>`
        : `<a class="card-cover" href="#/p/${index}" aria-label="Open ${escapeHtml(project.title || "project")}">${projectTile(project, index)}</a>`;

      return `
        <article class="card${state.activePreviewEditorIndex === index ? " preview-selected" : ""}" data-index="${index}">
          <div class="vintage-print">
            <div class="project-preview">
              ${cardCover}
            </div>
            ${meta}
          </div>
        </article>
      `;
    }).join("") || '<p class="empty">Selected work will appear here.</p>';

    const workLayout = select(".work-layout");
    const editor = select("#project-editor");
    const activeProject = state.projects[state.activePreviewEditorIndex];
    workLayout.classList.toggle("has-editor", state.admin && state.previewEditorOpen);
    editor.hidden = !state.admin || !state.previewEditorOpen;
    editor.innerHTML = !state.admin || !state.previewEditorOpen
      ? ""
      : activeProject
        ? `
        <div class="project-editor-heading">
          <div>
            <p class="project-editor-kicker">Preview editor</p>
            <h3>${escapeHtml(activeProject.title || "Untitled project")}</h3>
          </div>
          <button type="button" class="project-editor-close" data-project-action="close-editor" aria-label="Close preview editor">×</button>
        </div>
        <a class="project-editor-open" href="#/p/${state.activePreviewEditorIndex}">Edit full project page ↗</a>
        <p class="project-editor-help">Drag to reframe. Position snaps near center; zoom adjusts in 5% steps.</p>
        ${projectControls(state.activePreviewEditorIndex)}
      `
        : `
        <p class="project-editor-kicker">Preview editor</p>
        <p class="project-editor-empty">Select a work preview to edit its card image, color, position and zoom.</p>
      `;
    refreshCoverFraming();
    refreshClotheslines();

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
        <button type="button" class="block-drag" data-block-drag aria-label="Drag media block to reorder" title="Drag to reorder">↕</button>
        ${isMediaBlock(block)
        ? `<div class="media-size-control"><span>Width</span><input type="range" min="1" max="100" step="1" data-block-size data-index="${index}" value="${mediaWidth(block)}" aria-label="Media width"><input type="number" min="1" max="100" step="1" data-block-size-number data-index="${index}" value="${mediaWidth(block)}" aria-label="Media width percentage"><span>%</span></div>`
        : ""}
        ${isMediaBlock(block)
        ? `<div class="media-align-control" role="group" aria-label="Media alignment">
            <button type="button" data-media-align="left" data-index="${index}" class="${block.align === "left" ? "selected" : ""}" aria-label="Align media left" title="Align left">L</button>
            <button type="button" data-media-align="center" data-index="${index}" class="${block.align === "center" ? "selected" : ""}" aria-label="Align media center" title="Align center">C</button>
            <button type="button" data-media-align="right" data-index="${index}" class="${block.align === "right" ? "selected" : ""}" aria-label="Align media right" title="Align right">R</button>
          </div>`
        : ""}
        ${block.type === "image"
        ? `<label class="block-color" title="Image background color"><input type="color" data-block-color data-index="${index}" value="${escapeHtml(block.bg || "#000000")}" aria-label="Image background color"></label>`
        : ""}
        ${isMediaBlock(block)
        ? `<button type="button" data-block-action="replace" data-index="${index}" aria-label="${block.type === "youtube" ? "Edit YouTube URL" : "Replace media"}">${block.type === "youtube" ? "Edit URL" : "Replace"}</button>`
        : ""}
        <button type="button" data-block-action="up" data-index="${index}" aria-label="Move block up">↑</button>
        <button type="button" data-block-action="down" data-index="${index}" aria-label="Move block down">↓</button>
        ${!isMediaBlock(block)
        ? `<button type="button" data-block-action="width" data-index="${index}" aria-label="Toggle block width">↔</button>`
        : ""}
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
    const insertControls = state.admin
      ? `<div class="block-insert-controls">
          <button type="button" class="media-insert" data-media-insert="${index + 1}">+ Media after</button>
          <button type="button" class="media-insert" data-block-insert="divider" data-index="${index + 1}">+ Line after</button>
        </div>`
      : "";
    const editableText = (placeholder) => state.admin
      ? ` contenteditable="true" spellcheck="false" data-block-field="text" data-index="${index}" data-placeholder="${placeholder}"`
      : "";

    if (block.type === "image") {
      if (!source && !state.admin) {
        return "";
      }

      const image = source
        ? `<img src="${escapeHtml(source)}" alt="" style="background:${escapeHtml(block.bg || "transparent")}">`
        : "";
      const media = source
        ? state.admin
          ? image
          : `<button type="button" class="image-viewer-trigger" aria-label="View image larger">${image}</button>`
        : state.admin ? '<div class="media-empty">Choose “Photo / video” to add an image.</div>' : "";
      const dropZones = state.admin
        ? `<div class="media-drop-zones" aria-hidden="true">
            <div class="media-drop-zone" data-media-drop-side="before">Drop media before</div>
            <div class="media-drop-zone" data-media-drop-side="after">Drop media after</div>
          </div>`
        : "";
      return `<figure class="b media-block image-block" data-block="${index}" style="grid-column:${mediaGridStyle(block)}">${controls}<div class="media-canvas">${media}</div>${dropZones}${insertControls}</figure>`;
    }

    if (block.type === "video") {
      if (!source && !state.admin) {
        return "";
      }

      const media = source
        ? `<video src="${escapeHtml(source)}" controls playsinline preload="metadata"></video>`
        : state.admin ? '<div class="media-empty">Choose “Photo / video” to add a video.</div>' : "";
      const dropZones = state.admin
        ? `<div class="media-drop-zones" aria-hidden="true">
            <div class="media-drop-zone" data-media-drop-side="before">Drop media before</div>
            <div class="media-drop-zone" data-media-drop-side="after">Drop media after</div>
          </div>`
        : "";
      return `<figure class="b media-block video-block" data-block="${index}" style="grid-column:${mediaGridStyle(block)}">${controls}<div class="media-canvas">${media}</div>${dropZones}${insertControls}</figure>`;
    }

    if (block.type === "youtube") {
      const embedUrl = youtubeEmbedUrl(block.url);
      const watchUrl = embedUrl
        ? embedUrl.replace("www.youtube-nocookie.com/embed/", "www.youtube.com/watch?v=")
        : "";
      const media = embedUrl
        ? location.protocol === "file:"
          ? '<div class="youtube-local-notice">YouTube previews need a hosted page. Open the link below while viewing this local copy.</div>'
          : `<iframe class="youtube-player" src="${escapeHtml(embedUrl)}" title="YouTube video player" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`
        : state.admin ? '<div class="media-empty">Add a valid YouTube link.</div>' : "";
      const dropZones = state.admin
        ? `<div class="media-drop-zones" aria-hidden="true">
            <div class="media-drop-zone" data-media-drop-side="before">Drop media before</div>
            <div class="media-drop-zone" data-media-drop-side="after">Drop media after</div>
          </div>`
        : "";
      if (!embedUrl && !state.admin) return "";
      const watchLink = watchUrl
        ? `<a class="youtube-watch-link" href="${escapeHtml(watchUrl)}" target="_blank" rel="noopener noreferrer">Watch on YouTube ↗</a>`
        : "";
      return `<figure class="b media-block youtube-block" data-block="${index}" style="grid-column:${mediaGridStyle(block)}">${controls}<div class="media-canvas"><div class="${location.protocol === "file:" ? "youtube-local-frame" : "youtube-frame"}">${media}</div>${watchLink}</div>${dropZones}${insertControls}</figure>`;
    }

    if (block.type === "divider") {
      return `<div class="b divider${widthClass}" data-block="${index}">${controls}<span class="divider-rule" role="separator" aria-label="Section separator"></span>${insertControls}</div>`;
    }

    if (block.type === "heading") {
      if (!String(block.text || "").trim() && !state.admin) {
        return "";
      }

      return `
        <div class="b t h" data-block="${index}">
          ${controls}
          <div class="block-content"${editableText("Heading")}>${escapeHtml(block.text)}</div>
          ${insertControls}
        </div>
      `;
    }

    if (block.type === "text") {
      if (!String(block.text || "").trim() && !state.admin) {
        return "";
      }

      return `
        <div class="b t${widthClass}" data-block="${index}">
          ${controls}
          <div class="block-content"${editableText("Text")}>${escapeHtml(block.text)}</div>
          ${insertControls}
        </div>
      `;
    }

    return "";
  }

  function renderProject(project) {
    const blocks = Array.isArray(project.blocks) ? project.blocks : [];
    const renderedBlocks = blocks.map(blockHtml).join("");
    const mediaHint = state.admin && blocks.some(isMediaBlock)
      ? '<p class="image-placement-hint">Drag media with its ↕ handle. Use the separate boxes below a media block to position it; type a width or use the slider.</p>'
      : "";
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
      <div class="project-rule" aria-hidden="true"></div>
      ${state.admin ? `
        <div class="block-insert-controls media-insert-start">
          <button type="button" class="media-insert" data-media-insert="0">+ Media at start</button>
          <button type="button" class="media-insert" data-block-insert="divider" data-index="0">+ Line at start</button>
        </div>
      ` : ""}
      ${mediaHint}
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
    if (await restoreEditorSession()) {
      routePage();
      return;
    }

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

  function openEditorDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(editorDatabaseName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("handles");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open editor storage."));
    });
  }

  async function storeProjectFolder(folder) {
    const database = await openEditorDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("handles", "readwrite");
        transaction.objectStore("handles").put(folder, "projectFolder");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error("Could not store the portfolio folder."));
        transaction.onabort = () => reject(transaction.error || new Error("Could not store the portfolio folder."));
      });
    } finally {
      database.close();
    }
  }

  async function getStoredProjectFolder() {
    const database = await openEditorDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction("handles", "readonly");
        const request = transaction.objectStore("handles").get("projectFolder");
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error("Could not read the saved portfolio folder."));
      });
    } finally {
      database.close();
    }
  }

  async function readProjectsFromFolder(folder) {
    await folder.getFileHandle("index.html");
    const content = await folder.getDirectoryHandle("content");
    const fileHandle = await content.getFileHandle("projects.json");
    const file = await fileHandle.getFile();
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.projects)) {
      throw new Error("content/projects.json is not a valid project list.");
    }
    return data.projects;
  }

  async function restoreEditorSession() {
    if (sessionStorage.getItem(editorSessionKey) !== "true") {
      return false;
    }

    try {
      const folder = await getStoredProjectFolder();
      if (!folder) {
        throw new Error("The saved portfolio folder is unavailable.");
      }

      const permission = await folder.queryPermission({ mode: "readwrite" });
      if (permission !== "granted") {
        sessionStorage.removeItem(editorSessionKey);
        showToast("The local editor needs folder access again. Click the logo five times and choose your portfolio folder.");
        return false;
      }

      state.projectFolder = folder;
      state.projects = await readProjectsFromFolder(folder);
      state.admin = true;
      state.dirty = false;
      select("#admin-status").textContent = "Local editor restored";
      return true;
    } catch (error) {
      console.error("Could not restore the local editor:", error);
      sessionStorage.removeItem(editorSessionKey);
      showToast(`Could not restore the local editor: ${error.message}`);
      return false;
    }
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
      const projects = await readProjectsFromFolder(folder);

      state.projectFolder = folder;
      state.projects = projects;
      state.admin = true;
      state.dirty = false;
      let recoveryWarning = "";
      try {
        await storeProjectFolder(folder);
        sessionStorage.setItem(editorSessionKey, "true");
      } catch (error) {
        console.error("Could not save local editor recovery data:", error);
        recoveryWarning = `Edit mode is on, but it cannot be restored after a page reload: ${error.message}`;
      }
      select("#admin-status").textContent = "Local editor ready";
      routePage();
      showToast(recoveryWarning || "Edit mode on. Changes appear directly on the page.");
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

 function addYouTubeBlock() {
  const project = currentProject();

  if (!state.admin || !project) {
    showToast("Open a project before adding a YouTube video.");
    return;
  }

  const url = window.prompt("Paste a YouTube video link.");

  if (url === null) return;

  if (!youtubeEmbedUrl(url)) {
    showToast("Enter a valid YouTube video link.");
    return;
  }

  const blocks = ensureProjectBlocks(project);

  blocks.push({
    type: "youtube",
    url: url.trim(),
    w: "full",
    width: 100
  });

  markDirty();
  drawPage();

  select(`#proj .b[data-block="${blocks.length - 1}"]`)
    ?.scrollIntoView({ block: "center" });

  saveProjects().catch((error) => {
    console.error("Could not save YouTube video:", error);
    showToast("YouTube video added, but could not be saved.");
  });
}

  function addDivider(index) {
    const project = currentProject();
    if (!state.admin || !project) {
      showToast("Open a project first.");
      return;
    }

    const blocks = ensureProjectBlocks(project);
    const insertAt = Number.isInteger(index)
      ? Math.min(Math.max(index, 0), blocks.length)
      : blocks.length;
    blocks.splice(insertAt, 0, { type: "divider", w: "full" });
    markDirty();
    drawPage();
    const divider = select(`#proj [data-block="${insertAt}"]`);
    if (divider) {
      divider.scrollIntoView({ block: "center" });
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
    if (file.size > 95 * 1024 * 1024) {
      throw new Error("Keep uploads under 95 MiB; GitHub rejects files over 100 MiB.");
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
    const editorContext = state.mediaEditorContext;
    restoreMediaEditorContext(editorContext);
    const mediaProjectIndex = state.mediaProjectIndex;
    const mediaInsertIndex = state.mediaInsertIndex;
    const project = Number.isInteger(mediaProjectIndex)
      ? state.projects[mediaProjectIndex]
      : currentProject();
    if (!state.admin || !project) {
      state.replaceBlockIndex = null;
      state.mediaProjectIndex = null;
      state.mediaInsertIndex = null;
      state.mediaEditorContext = null;
      showToast("Open a project before adding media.");
      return;
    }

    const blocks = ensureProjectBlocks(project);
    const fileList = Array.from(files);
    const scrollTop = window.scrollY;
    let added = 0;
    let insertedCount = 0;
    try {
      for (const file of fileList) {
        const block = await storeMedia(file);
        if (Number.isInteger(mediaProjectIndex) && block.type === "image") {
          project.coverFile = block.file;
          state.coverPreviews.set(project, URL.createObjectURL(file));
          added += 1;
          markDirty();
          continue;
        }
        const replaceIndex = state.replaceBlockIndex;
        let visibleBlock = block;
        if (replaceIndex !== null && fileList.length === 1) {
          const previousBlock = blocks[replaceIndex];
          if (previousBlock) {
            releaseMediaPreview(previousBlock);
          }
          visibleBlock = { ...previousBlock, ...block };
          blocks[replaceIndex] = visibleBlock;
        } else if (Number.isInteger(mediaInsertIndex)) {
          blocks.splice(Math.min(mediaInsertIndex + insertedCount, blocks.length), 0, visibleBlock);
          insertedCount += 1;
        } else {
          blocks.push(visibleBlock);
        }
        state.mediaPreviews.set(visibleBlock, URL.createObjectURL(file));
        added += 1;
        markDirty();
      }

      if (added) {
        restoreMediaEditorContext(editorContext);
        state.replaceBlockIndex = null;
        state.mediaProjectIndex = null;
        state.mediaInsertIndex = null;
        state.mediaEditorContext = null;
        drawPage();
        window.scrollTo(0, scrollTop);
        await saveProjects();
        showToast(`${added} media file${added === 1 ? "" : "s"} added and saved.`);
      }
    } catch (error) {
      console.error("Could not add project media:", error);
      restoreMediaEditorContext(editorContext);
      state.replaceBlockIndex = null;
      state.mediaProjectIndex = null;
      state.mediaInsertIndex = null;
      state.mediaEditorContext = null;
      if (added) {
        drawPage();
        window.scrollTo(0, scrollTop);
      } else {
        drawPage();
      }
      showToast(error.message || "Media upload failed.");
    }
  }

function openMediaPicker(replaceIndex, projectIndex, insertIndex) {
  state.mediaProjectIndex = Number.isInteger(projectIndex)
    ? projectIndex
    : null;

  state.mediaInsertIndex = Number.isInteger(insertIndex)
    ? insertIndex
    : null;

  if (!Number.isInteger(projectIndex) && !currentProject()) {
    if (state.projects.length !== 1) {
      state.replaceBlockIndex = null;
      state.mediaProjectIndex = null;
      state.mediaInsertIndex = null;
      state.mediaEditorContext = null;

      showToast(
        state.projects.length
          ? "Open the project you want to add media to."
          : "Create a project before adding media."
      );

      return;
    }

    state.projectIndex = 0;
    location.hash = "#/p/0";
    drawPage();
    window.scrollTo(0, 0);
  }

  state.replaceBlockIndex = replaceIndex;

  state.mediaEditorContext = {
    admin: state.admin,
    projectIndex: state.projectIndex,
    hash: location.hash,
  };

  const choice = window.confirm(
    "Add a YouTube video?\n\nOK = YouTube link\nCancel = upload image/video"
  );

  if (choice) {
    addYouTubeMedia(
      replaceIndex,
      state.mediaProjectIndex,
      state.mediaInsertIndex
    );

    state.replaceBlockIndex = null;
    state.mediaProjectIndex = null;
    state.mediaInsertIndex = null;
    state.mediaEditorContext = null;

    return;
  }

  select("#media-file").click();
}

  function restoreMediaEditorContext(context) {
    if (!context || !context.admin) {
      return;
    }

    state.admin = true;
    state.projectIndex = context.projectIndex;
    if (location.hash !== context.hash) {
      location.hash = context.hash;
    }
  }

  async function deleteProject(index) {
    const project = state.projects[index];
    if (!project || !window.confirm(`Delete "${project.title || "Untitled project"}"?`)) {
      return;
    }

    (Array.isArray(project.blocks) ? project.blocks : []).forEach(releaseMediaPreview);
    state.projects.splice(index, 1);
    if (state.activePreviewEditorIndex === index) {
      state.activePreviewEditorIndex = null;
    } else if (state.activePreviewEditorIndex !== null && state.activePreviewEditorIndex > index) {
      state.activePreviewEditorIndex -= 1;
    }
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
    const button = event.target.closest("button[data-project-action]");
    if (!button || !state.admin) {
      return false;
    }

    event.preventDefault();
    const index = Number(button.dataset.index);
    const action = button.dataset.projectAction;

    if (action === "close-editor") {
      state.activePreviewEditorIndex = null;
      state.previewEditorOpen = false;
      renderHome();
      return true;
    }

    if (action === "upload-cover") {
      state.replaceBlockIndex = null;
      openMediaPicker(null, index);
      return true;
    }

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
    state.activePreviewEditorIndex = nextIndex;
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
      if (block.type === "youtube") {
        const url = window.prompt("Paste a YouTube video link.", block.url || "");
        if (url === null) return true;
        if (!youtubeEmbedUrl(url)) {
          showToast("Enter a valid YouTube video link.");
          return true;
        }
        block.url = url.trim();
        markDirty();
        drawPage();
        return true;
      }
      openMediaPicker(index);
      return true;
    }

    if (action === "remove") {
      releaseMediaPreview(block);
      if (project.coverFile === block.file) {
        project.coverFile = "";
      }
      project.blocks.splice(index, 1);
    } else if (action === "cover") {
      project.blocks.forEach((item) => {
        if (item.type === "image") {
          item.cover = false;
        }
      });
      block.cover = true;
      project.coverFile = block.file;
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
  window.addEventListener("resize", () => {
    refreshCoverFraming();
    refreshClotheslines();
  });

  select("#grid").addEventListener("click", (event) => {
    if (suppressCoverClick) {
      event.preventDefault();
      suppressCoverClick = false;
      return;
    }

    const cover = event.target.closest(".card-cover");
    if (state.admin && cover) {
      event.preventDefault();
      state.activePreviewEditorIndex = Number(cover.closest(".card").dataset.index);
      state.previewEditorOpen = true;
      renderHome();
      return;
    }

    if (state.admin && event.target.closest("[contenteditable]")) {
      event.stopPropagation();
    }
  });

  select("#grid").addEventListener("pointerdown", (event) => {
    if (!state.admin || event.button !== 0) return;

    const image = event.target.closest("[data-cover-image]");
    const card = image && image.closest(".card[data-index]");
    if (!image || !card) return;

    const index = Number(card.dataset.index);
    if (index !== state.activePreviewEditorIndex) return;

    const project = state.projects[index];
    const frame = image.parentElement.getBoundingClientRect();
    if (!project || !image.naturalWidth || !frame.width || !frame.height) return;

    const position = project.coverPosition || { x: 50, y: 50 };
    coverPointerDrag = {
      image,
      index,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: Number.isFinite(Number(position.x)) ? Number(position.x) : 50,
      baseY: Number.isFinite(Number(position.y)) ? Number(position.y) : 50,
      overflowX: image.clientWidth - frame.width,
      overflowY: image.clientHeight - frame.height,
      moved: false,
    };
    image.setPointerCapture(event.pointerId);
    image.classList.add("is-cropping");
    event.preventDefault();
  });

  select("#grid").addEventListener("pointermove", (event) => {
    const drag = coverPointerDrag;
    if (!state.admin || !drag || event.pointerId !== drag.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) drag.moved = true;

    const project = state.projects[drag.index];
    if (!project) return;
    project.coverPosition = project.coverPosition || { x: 50, y: 50 };
    project.coverPosition.x = drag.overflowX
      ? Math.min(100, Math.max(0, drag.baseX - deltaX * 100 / drag.overflowX))
      : drag.baseX;
    project.coverPosition.y = drag.overflowY
      ? Math.min(100, Math.max(0, drag.baseY - deltaY * 100 / drag.overflowY))
      : drag.baseY;

    applyCoverFraming(drag.image, project);
    ["x", "y"].forEach((axis) => {
      const input = select(`#project-editor [data-cover-position="${axis}"]`);
      if (input) {
        const value = Math.round(project.coverPosition[axis]);
        input.value = String(value);
        input.closest(".range-control").querySelector("output").textContent = `${value}%`;
      }
    });
    markDirty();
  });

  select("#grid").addEventListener("pointerup", (event) => {
    const drag = coverPointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const project = state.projects[drag.index];
    if (project) {
      project.coverPosition = project.coverPosition || { x: 50, y: 50 };
      ["x", "y"].forEach((axis) => {
        const positionValue = Number(project.coverPosition[axis]);
        const value = Number.isFinite(positionValue) ? Math.round(positionValue) : 50;
        const snapPoint = [0, 50, 100].find((point) => Math.abs(point - value) <= 2);
        project.coverPosition[axis] = snapPoint === undefined ? value : snapPoint;
      });
      applyCoverFraming(drag.image, project);
      ["x", "y"].forEach((axis) => {
        const input = select(`#project-editor [data-cover-position="${axis}"]`);
        if (input) {
          const value = project.coverPosition[axis];
          input.value = String(value);
          input.closest(".range-control").querySelector("output").textContent = `${value}%`;
        }
      });
    }

    if (drag.moved) {
      suppressCoverClick = true;
      window.setTimeout(() => {
        suppressCoverClick = false;
      }, 0);
    }
    drag.image.classList.remove("is-cropping");
    if (drag.image.hasPointerCapture(event.pointerId)) {
      drag.image.releasePointerCapture(event.pointerId);
    }
    coverPointerDrag = null;
  });

  select("#grid").addEventListener("pointercancel", (event) => {
    if (!coverPointerDrag || event.pointerId !== coverPointerDrag.pointerId) return;
    coverPointerDrag.image.classList.remove("is-cropping");
    coverPointerDrag = null;
  });

  select("#project-editor").addEventListener("click", (event) => {
    handleProjectControls(event);
  });

  select("#project-editor").addEventListener("input", (event) => {
    if (!state.admin
      || !event.target.matches("[data-cover-position], [data-cover-zoom]")) return;

    const index = Number(event.target.dataset.index);
    const project = state.projects[index];
    if (!project) return;

    const output = event.target.closest(".range-control").querySelector("output");
    const image = select(`#grid .card[data-index="${index}"] .cover-media img`);
    if (event.target.matches("[data-cover-position]")) {
      project.coverPosition = project.coverPosition || { x: 50, y: 50 };
      project.coverPosition[event.target.dataset.coverPosition] = Number(event.target.value);
      output.value = `${event.target.value}%`;
      output.textContent = output.value;
      if (image) {
        applyCoverFraming(image, project);
      }
    } else {
      project.coverZoom = Number(event.target.value);
      output.value = `${Math.round(project.coverZoom * 100)}%`;
      output.textContent = output.value;
      if (image) {
        applyCoverFraming(image, project);
      }
    }
    markDirty();
  });

  select("#project-editor").addEventListener("change", (event) => {
    if (!state.admin) return;

    if (event.target.matches("[data-project-action=\"cover\"]")) {
      const project = state.projects[Number(event.target.dataset.index)];
      const blockIndex = Number(event.target.value);
      if (project) {
        (project.blocks || []).forEach((block) => {
          if (block.type === "image") block.cover = false;
        });
        const block = project.blocks[blockIndex];
        if (block) block.cover = true;
        project.coverFile = block && block.file ? block.file : "";
        markDirty();
        renderHome();
      }
    }

    if (event.target.matches("[data-cover-color]")) {
      const project = state.projects[Number(event.target.dataset.index)];
      if (project) {
        project.coverBg = event.target.value;
        markDirty();
        renderHome();
      }
    }

  });

  select("#proj").addEventListener("click", (event) => {
    const imageTrigger = event.target.closest(".image-viewer-trigger");
    if (imageTrigger) {
      const image = imageTrigger.querySelector("img");
      const lightbox = select("#image-lightbox");
      const lightboxImage = select("#image-lightbox-image");
      if (image && lightbox && lightboxImage) {
        lightboxImage.src = image.currentSrc || image.src;
        lightboxImage.alt = image.alt;
        lightbox.showModal();
      }
      return;
    }

    const alignmentButton = event.target.closest("[data-media-align]");
    if (alignmentButton && state.admin) {
      event.preventDefault();
      const project = currentProject();
      const block = project && project.blocks[Number(alignmentButton.dataset.index)];
      const alignment = alignmentButton.dataset.mediaAlign;
      if (isMediaBlock(block) && ["left", "center", "right"].includes(alignment)) {
        block.align = alignment;
        markDirty();
        drawPage();
      }
      return;
    }

    const lineButton = event.target.closest("[data-block-insert='divider']");
    if (lineButton && state.admin) {
      event.preventDefault();
      addDivider(Number(lineButton.dataset.index));
      return;
    }

    const insertButton = event.target.closest("[data-media-insert]");
    if (insertButton && state.admin) {
      event.preventDefault();
      openMediaPicker(null, null, Number(insertButton.dataset.mediaInsert));
      return;
    }

    handleBlockControls(event);
  });

  select("#image-lightbox").addEventListener("click", (event) => {
    if (event.target === event.currentTarget || event.target.closest("[data-lightbox-close]")) {
      event.currentTarget.close();
    }
  });

  function placeBlock(from, target, clientY, side) {
    const project = currentProject();
    const targetElement = Number.isInteger(target)
      ? select(`#proj .b[data-block="${target}"]`)
      : null;
    if (!project || !targetElement) {
      return;
    }

    const block = project.blocks[from];
    const targetBlock = project.blocks[target];
    if (!block || !targetBlock) {
      return;
    }

    const pairMedia = from !== target
      && isMediaBlock(block)
      && isMediaBlock(targetBlock);
    const bounds = targetElement.getBoundingClientRect();
    let insertAt = target + (side
      ? side === "after" ? 1 : 0
      : clientY < bounds.top + bounds.height / 2 ? 0 : 1);
    const staysInPlace = from === insertAt || from + 1 === insertAt;
    let changed = false;

    if (staysInPlace) {
      if (pairMedia) changed = pairMediaBlocks(project, block, targetBlock) || changed;
    } else {
      project.blocks.splice(from, 1);
      if (from < insertAt) {
        insertAt -= 1;
      }
      project.blocks.splice(insertAt, 0, block);
      changed = true;
      if (pairMedia) changed = pairMediaBlocks(project, block, targetBlock) || changed;
    }

    if (changed) {
      markDirty();
      drawPage();
    }
  }

  function clearBlockDropTargets() {
    select("#proj").querySelectorAll(".drop-before, .drop-after").forEach((block) => {
      block.classList.remove("drop-before", "drop-after");
    });
    select("#proj").querySelectorAll(".media-drop-zone.is-target").forEach((zone) => {
      zone.classList.remove("is-target");
    });
  }

  function finishBlockPointerDrag(drag) {
    if (drag.handle.hasPointerCapture(drag.pointerId)) {
      drag.handle.releasePointerCapture(drag.pointerId);
    }
    drag.handle.closest(".b[data-block]")?.classList.remove("is-dragging");
    state.blockPointerDrag = null;
    state.draggedBlockIndex = null;
    document.body.classList.remove("media-dragging");
    clearBlockDropTargets();
  }

  select("#proj").addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-block-drag]");
    const block = handle && handle.closest(".b[data-block]");
    if (!state.admin || event.button !== 0 || !block) return;

    event.preventDefault();
    state.draggedBlockIndex = Number(block.dataset.block);
    state.blockPointerDrag = {
      from: state.draggedBlockIndex,
      handle,
      pointerId: event.pointerId,
    };
    handle.setPointerCapture(event.pointerId);
    const draggedBlock = currentProject()?.blocks[state.draggedBlockIndex];
    document.body.classList.toggle("media-dragging", isMediaBlock(draggedBlock));
    block.classList.add("is-dragging");
  });

  document.addEventListener("pointermove", (event) => {
    const drag = state.blockPointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const hovered = document.elementFromPoint(event.clientX, event.clientY);
    const dropZone = hovered && hovered.closest("[data-media-drop-side]");
    const target = dropZone
      ? dropZone.closest(".b[data-block]")
      : hovered && hovered.closest(".b[data-block]");
    if (!target || dropZone && !isMediaBlock(currentProject()?.blocks[drag.from])) {
      clearBlockDropTargets();
      return;
    }

    event.preventDefault();
    clearBlockDropTargets();

    if (dropZone) {
      dropZone.classList.add("is-target");
    } else {
      const bounds = target.getBoundingClientRect();
      target.classList.add(event.clientY < bounds.top + bounds.height / 2
        ? "drop-before"
        : "drop-after");
    }
  });

  document.addEventListener("pointerup", (event) => {
    const drag = state.blockPointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const hovered = document.elementFromPoint(event.clientX, event.clientY);
    const dropZone = hovered && hovered.closest("[data-media-drop-side]");
    const target = dropZone
      ? dropZone.closest(".b[data-block]")
      : hovered && hovered.closest(".b[data-block]");
    const canDrop = target && (!dropZone || isMediaBlock(currentProject()?.blocks[drag.from]));
    const targetIndex = canDrop ? Number(target.dataset.block) : null;
    const side = dropZone && dropZone.dataset.mediaDropSide;
    finishBlockPointerDrag(drag);
    if (canDrop) {
      placeBlock(drag.from, targetIndex, event.clientY, side);
    }
  });

  document.addEventListener("pointercancel", (event) => {
    const drag = state.blockPointerDrag;
    if (drag && event.pointerId === drag.pointerId) {
      finishBlockPointerDrag(drag);
    }
  });

  select("#proj").addEventListener("input", (event) => {
    if (!state.admin || !event.target.matches("[data-block-size]")) return;

    const project = currentProject();
    const block = project && project.blocks[Number(event.target.dataset.index)];
    if (!block) return;

    applyMediaWidthControl(event.target, block, event.target.value);
  });

  select("#proj").addEventListener("change", (event) => {
    if (!state.admin) return;

    if (event.target.matches("[data-block-size-number]")) {
      const project = currentProject();
      const block = project && project.blocks[Number(event.target.dataset.index)];
      if (block) {
        applyMediaWidthControl(event.target, block, event.target.value);
      }
      return;
    }

    if (!event.target.matches("[data-block-color]")) return;
    const project = currentProject();
    const block = project && project.blocks[Number(event.target.dataset.index)];
    if (block) {
      block.bg = event.target.value;
      markDirty();
      drawPage();
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.matches("[contenteditable]")) {
      updateEditedContent(event.target);
      refreshClotheslines();
    }
  });

  document.addEventListener("keydown", (event) => {
    const lightbox = select("#image-lightbox");
    if (event.key === "Escape" && lightbox.open) {
      event.preventDefault();
      lightbox.close();
    }

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
    } else if (action === "youtube") {
      addYouTubeBlock();
    } else if (action === "heading" || action === "text") {
      addTextBlock(action);
    } else if (action === "line") {
      addDivider();
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
      sessionStorage.removeItem(editorSessionKey);
      drawPage();
      showToast("Edit mode off.");
    }
  });

  select("#media-file").addEventListener("change", function () {
    const files = Array.from(this.files);
    this.value = "";
    if (!files.length) {
      state.replaceBlockIndex = null;
      state.mediaProjectIndex = null;
      state.mediaInsertIndex = null;
      state.mediaEditorContext = null;
      return;
    }
    addMedia(files);
  });

  function addYouTubeMedia(replaceIndex, projectIndex, insertIndex) {
  const project = Number.isInteger(projectIndex)
    ? state.projects[projectIndex]
    : currentProject();

  if (!state.admin || !project) {
    showToast("Open a project before adding a YouTube video.");
    return;
  }

  const url = window.prompt("Paste a YouTube video link.");

  if (url === null) return;

  const embedUrl = youtubeEmbedUrl(url);

  if (!embedUrl) {
    showToast("Enter a valid YouTube video link.");
    return;
  }

  const blocks = ensureProjectBlocks(project);

  const youtubeBlock = {
    type: "youtube",
    url: url.trim(),
    w: "full",
    width: 100
  };

  if (Number.isInteger(replaceIndex)) {
    const previousBlock = blocks[replaceIndex];

    if (previousBlock) {
      releaseMediaPreview(previousBlock);
    }

    blocks[replaceIndex] = {
      ...previousBlock,
      ...youtubeBlock
    };

  } else if (Number.isInteger(insertIndex)) {
    blocks.splice(
      Math.min(insertIndex, blocks.length),
      0,
      youtubeBlock
    );

  } else {
    blocks.push(youtubeBlock);
  }

  markDirty();
  drawPage();

  const newIndex = blocks.indexOf(youtubeBlock);

  if (newIndex >= 0) {
    select(`#proj .b[data-block="${newIndex}"]`)
      ?.scrollIntoView({ block: "center" });
  }

  saveProjects()
    .then(() => {
      showToast("YouTube video added and saved.");
    })
    .catch((error) => {
      console.error("Could not save YouTube video:", error);
      showToast("YouTube video added, but could not be saved.");
    });
}

  loadProjects().catch((error) => {
    console.error("Could not load portfolio projects:", error);
    select("#grid").innerHTML = '<p class="empty" role="alert">Could not load projects. Refresh the page and try again.</p>';
  });
})();
