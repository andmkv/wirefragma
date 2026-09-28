// Wirefragma docs: sidebar navigation, "on this page" table of contents, previous/next links and
// copy buttons for code blocks. Plain script, no dependencies. Pages remain fully readable without
// it; the navigation list below is the single place to add a page.
(function () {
  var PAGES = [
    { group: "Getting started" },
    { href: "index.html", title: "Overview" },
    { href: "editor.html", title: "Using the editor" },
    { href: "export.html", title: "Export & import" },
    { group: "Accounts" },
    { href: "accounts.html", title: "Accounts & projects" },
    { group: "Agents & API" },
    { href: "mcp.html", title: "MCP for coding agents" },
    { href: "api.html", title: "Project format & HTTP API" },
    { group: "Operators" },
    { href: "self-hosting.html", title: "Self-hosting" }
  ];

  var here = location.pathname.split("/").pop() || "index.html";

  // Sidebar
  var sidebar = document.querySelector("[data-nav]");
  if (sidebar) {
    var html = "";
    PAGES.forEach(function (page) {
      if (page.group) html += '<div class="group">' + page.group + "</div>";
      else html += '<a href="' + page.href + '"' + (page.href === here ? ' aria-current="page"' : "") + ">" + page.title + "</a>";
    });
    sidebar.innerHTML = html;
  }

  // Mobile menu
  var toggle = document.querySelector(".menu-toggle");
  if (toggle) toggle.addEventListener("click", function () { document.body.classList.toggle("nav-open"); });

  // Table of contents from h2/h3 with ids
  var toc = document.querySelector("[data-toc]");
  if (toc) {
    var headings = document.querySelectorAll("article h2[id], article h3[id]");
    if (headings.length > 1) {
      var items = '<div class="title">On this page</div>';
      headings.forEach(function (h) {
        items += '<a href="#' + h.id + '"' + (h.tagName === "H3" ? ' class="sub"' : "") + ">" + h.textContent + "</a>";
      });
      toc.innerHTML = items;
    }
  }

  // Previous / next
  var article = document.querySelector("article");
  var list = PAGES.filter(function (p) { return p.href; });
  var index = list.findIndex(function (p) { return p.href === here; });
  if (article && index >= 0) {
    var prev = list[index - 1], next = list[index + 1];
    var pager = document.createElement("nav");
    pager.className = "pager";
    pager.innerHTML =
      (prev ? '<a class="prev" href="' + prev.href + '"><small>Previous</small>' + prev.title + "</a>" : "") +
      (next ? '<a class="next" href="' + next.href + '"><small>Next</small>' + next.title + "</a>" : "");
    article.appendChild(pager);
  }

  // Copy buttons
  document.querySelectorAll("pre").forEach(function (pre) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "copy-code";
    button.textContent = "Copy";
    button.addEventListener("click", function () {
      var text = pre.querySelector("code") ? pre.querySelector("code").innerText : pre.innerText;
      var done = function () { button.textContent = "Copied"; setTimeout(function () { button.textContent = "Copy"; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(text.replace(/\n$/, "")).then(done, function () {});
    });
    pre.appendChild(button);
  });
})();
