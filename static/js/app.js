/**
 * Lead Tracker — Frontend Application
 * Ultra-fast client-side caching, instant filtering, and responsive state management.
 */

(function () {
  "use strict";

  const API = {
    leads: "/api/leads",
    stats: "/api/stats",
  };

  // Master State & In-Memory Cache
  let masterLeads = [];
  let inFlightFetch = null;
  let currentStatus = "All";
  let currentPriority = "All";
  let currentSearch = "";
  let currentSort = "attention";
  let editingId = null;
  let deletingId = null;
  let viewingId = null;

  // Helpers
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  function formatCurrency(value) {
    const n = Number(value) || 0;
    if (n >= 10000000) {
      return "₹" + (n / 10000000).toFixed(2).replace(/\.?0+$/, "") + "Cr";
    }
    if (n >= 100000) {
      return "₹" + (n / 100000).toFixed(2).replace(/\.?0+$/, "") + "L";
    }
    if (n >= 1000) {
      return "₹" + (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    }
    return "₹" + n.toLocaleString("en-IN");
  }

  function formatDate(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(String(iso).slice(0, 10) + "T00:00:00");
      return d.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch (e) {
      return iso;
    }
  }

  function daysSinceText(days) {
    if (days === null || days === undefined) return "No contact yet";
    if (days === 0) return "Contacted today";
    if (days === 1) return "1 day since contact";
    return days + " days since contact";
  }

  function priorityBadge(p) {
    const map = { Hot: "badge-hot", Warm: "badge-warm", Cold: "badge-cold" };
    return '<span class="badge ' + (map[p] || "") + '">' + escapeHtml(p) + "</span>";
  }

  function statusBadge(s) {
    const map = {
      New: "badge-new",
      Contacted: "badge-contacted",
      Converted: "badge-converted",
      Lost: "badge-lost",
    };
    return '<span class="badge ' + (map[s] || "") + '">' + escapeHtml(s) + "</span>";
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showToast(message, type) {
    type = type || "success";
    const container = $("#toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = "toast " + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function () {
      toast.classList.add("leaving");
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 200);
    }, 2800);
  }

  // Modal open/close — uses .open + .visible classes
  function openModal(overlay) {
    if (!overlay) return;
    overlay.removeAttribute("hidden");
    overlay.classList.add("open");
    // force reflow then fade in
    void overlay.offsetWidth;
    overlay.classList.add("visible");
    document.body.style.overflow = "hidden";
  }

  function closeModal(overlay) {
    if (!overlay) return;
    overlay.classList.remove("visible");
    setTimeout(function () {
      overlay.classList.remove("open");
      overlay.setAttribute("hidden", "");
      document.body.style.overflow = "";
    }, 200);
  }

  function isModalOpen(overlay) {
    return overlay && overlay.classList.contains("open");
  }

  // API Client with error handling
  async function api(url, options) {
    options = options || {};
    var opts = {
      headers: { "Content-Type": "application/json" },
    };
    if (options.method) opts.method = options.method;
    if (options.body) {
      opts.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    }
    var res = await fetch(url, opts);
    var data = {};
    try {
      data = await res.json();
    } catch (e) {}
    if (!res.ok) {
      var err = new Error(data.error || (data.errors && data.errors.join(", ")) || "Request failed");
      err.status = res.status;
      err.errors = data.errors;
      throw err;
    }
    return data;
  }

  // ========== In-Memory Filtering & Sorting Engine (< 5ms) ==========

  function getFilteredAndSortedLeads() {
    var todayStr = new Date().toISOString().slice(0, 10);
    var list = masterLeads.slice();

    // 1. Status filter
    if (currentStatus && currentStatus !== "All") {
      var targetStatus = currentStatus.toLowerCase();
      list = list.filter(function (l) {
        return (l.status || "").toLowerCase() === targetStatus;
      });
    }

    // 2. Priority filter
    if (currentPriority && currentPriority !== "All") {
      var targetPriority = currentPriority.toLowerCase();
      list = list.filter(function (l) {
        return (l.priority || "").toLowerCase() === targetPriority;
      });
    }

    // 3. Search query (case-insensitive substring across fields)
    if (currentSearch) {
      var q = currentSearch.toLowerCase();
      list = list.filter(function (l) {
        var name = (l.name || "").toLowerCase();
        var contact = (l.contact_number || "").toLowerCase();
        var source = (l.source || "").toLowerCase();
        var notes = (l.notes || "").toLowerCase();
        return (
          name.indexOf(q) !== -1 ||
          contact.indexOf(q) !== -1 ||
          source.indexOf(q) !== -1 ||
          notes.indexOf(q) !== -1
        );
      });
    }

    // 4. Sorting
    list.sort(function (a, b) {
      if (currentSort === "newest") {
        return (b.created_at || "").localeCompare(a.created_at || "") || (b.id - a.id);
      }
      if (currentSort === "oldest") {
        return (a.created_at || "").localeCompare(b.created_at || "") || (a.id - b.id);
      }
      if (currentSort === "value_high") {
        return (Number(b.deal_value) || 0) - (Number(a.deal_value) || 0);
      }
      if (currentSort === "value_low") {
        return (Number(a.deal_value) || 0) - (Number(b.deal_value) || 0);
      }
      if (currentSort === "followup") {
        if (a.next_follow_up && b.next_follow_up) {
          return a.next_follow_up.localeCompare(b.next_follow_up);
        }
        if (a.next_follow_up) return -1;
        if (b.next_follow_up) return 1;
        return 0;
      }
      if (currentSort === "priority") {
        var prioRank = { Hot: 1, Warm: 2, Cold: 3 };
        var rankA = prioRank[a.priority] || 99;
        var rankB = prioRank[b.priority] || 99;
        if (rankA !== rankB) return rankA - rankB;
        return (b.created_at || "").localeCompare(a.created_at || "");
      }

      // Default: "attention" (Needs Attention)
      // a) Overdue leads first
      var isOverdueA = a.is_overdue || (
        a.next_follow_up &&
        a.next_follow_up < todayStr &&
        a.status !== "Converted" &&
        a.status !== "Lost"
      );
      var isOverdueB = b.is_overdue || (
        b.next_follow_up &&
        b.next_follow_up < todayStr &&
        b.status !== "Converted" &&
        b.status !== "Lost"
      );

      if (isOverdueA && !isOverdueB) return -1;
      if (!isOverdueA && isOverdueB) return 1;

      // b) Leads with follow-up scheduled come before leads with no follow-up
      if (a.next_follow_up && !b.next_follow_up) return -1;
      if (!a.next_follow_up && b.next_follow_up) return 1;
      if (a.next_follow_up && b.next_follow_up) {
        var cmp = a.next_follow_up.localeCompare(b.next_follow_up);
        if (cmp !== 0) return cmp;
      }

      // c) Newest created as fallback
      return (b.created_at || "").localeCompare(a.created_at || "") || (b.id - a.id);
    });

    return list;
  }

  // ========== Dynamic Stats & Badge Count Calculation ==========

  function updateDynamicStatsAndBadges() {
    var todayStr = new Date().toISOString().slice(0, 10);
    var total = masterLeads.length;
    var overdue = 0;
    var pipeline = 0;
    var statusCounts = { New: 0, Contacted: 0, Converted: 0, Lost: 0 };

    masterLeads.forEach(function (lead) {
      var s = lead.status;
      if (statusCounts.hasOwnProperty(s)) {
        statusCounts[s]++;
      }

      var isOver = lead.is_overdue || (
        lead.next_follow_up &&
        lead.next_follow_up < todayStr &&
        s !== "Converted" &&
        s !== "Lost"
      );
      if (isOver) overdue++;

      if (s !== "Lost") {
        pipeline += (Number(lead.deal_value) || 0);
      }
    });

    // Update Dashboard Stats cards
    var el;
    el = $("#statTotal");
    if (el) el.textContent = total;
    el = $("#statOverdue");
    if (el) el.textContent = overdue;
    el = $("#statPipeline");
    if (el) el.textContent = formatCurrency(pipeline);

    // Update Filter Tab Badge Counts
    el = $("#countAll");
    if (el) el.textContent = total;
    el = $("#countNew");
    if (el) el.textContent = statusCounts.New || 0;
    el = $("#countContacted");
    if (el) el.textContent = statusCounts.Contacted || 0;
    el = $("#countConverted");
    if (el) el.textContent = statusCounts.Converted || 0;
    el = $("#countLost");
    if (el) el.textContent = statusCounts.Lost || 0;
  }

  // Instant view render
  function renderCurrentView() {
    updateResetButton();
    var filtered = getFilteredAndSortedLeads();
    renderLeads(filtered);
  }

  // Master leads fetch with request deduplication
  async function fetchMasterLeads(force) {
    if (inFlightFetch && !force) {
      return inFlightFetch;
    }

    inFlightFetch = (async function () {
      try {
        var res = await api(API.leads);
        masterLeads = res.data || [];
        updateDynamicStatsAndBadges();
        renderCurrentView();
        return masterLeads;
      } catch (e) {
        console.error("Leads fetch error:", e);
        showToast("Failed to load leads", "error");
        renderLeads([]);
        throw e;
      } finally {
        inFlightFetch = null;
      }
    })();

    return inFlightFetch;
  }

  async function loadStats() {
    try {
      var res = await api(API.stats);
      var d = res.data;
      if (!d) return;

      var el;
      el = $("#statTotal");
      if (el) el.textContent = d.total_leads;
      el = $("#statOverdue");
      if (el) el.textContent = d.overdue_followups;
      el = $("#statPipeline");
      if (el) el.textContent = formatCurrency(d.pipeline_value);

      var sc = d.status_counts || {};
      el = $("#countAll");
      if (el) el.textContent = d.total_leads;
      el = $("#countNew");
      if (el) el.textContent = sc.New || 0;
      el = $("#countContacted");
      if (el) el.textContent = sc.Contacted || 0;
      el = $("#countConverted");
      if (el) el.textContent = sc.Converted || 0;
      el = $("#countLost");
      if (el) el.textContent = sc.Lost || 0;
    } catch (e) {
      // If server stats fail, fallback is already computed dynamically
      console.warn("Stats API background sync note:", e);
    }
  }

  async function refreshAll() {
    await Promise.all([fetchMasterLeads(true), loadStats()]);
  }

  // Render Leads Table
  function renderLeads(leads) {
    var container = $("#leadsContainer");
    var empty = $("#emptyState");
    if (!container || !empty) return;

    if (!leads.length) {
      container.innerHTML = "";
      empty.hidden = false;
      var hasFilters =
        currentStatus !== "All" || currentPriority !== "All" || !!currentSearch;
      var title = $("#emptyTitle");
      var msg = $("#emptyMessage");
      var btn = $("#emptyAddBtn");
      if (hasFilters) {
        if (title) title.textContent = "No leads match your filters";
        if (msg) msg.textContent = "Try adjusting search or clearing filters.";
        if (btn) btn.textContent = "Clear Filters";
      } else {
        if (title) title.textContent = "No leads yet";
        if (msg) msg.textContent = "Start building your pipeline by adding your first lead.";
        if (btn) btn.textContent = "+ Add Lead";
      }
      return;
    }

    empty.hidden = true;
    container.innerHTML = leads.map(leadRowHTML).join("");
  }

  function leadRowHTML(lead) {
    var overdue = lead.is_overdue;
    var followupClass = overdue ? "overdue-date" : "";
    var followupContent = lead.next_follow_up
      ? (overdue ? '<span class="badge badge-overdue">OVERDUE</span>' : "") +
        formatDate(lead.next_follow_up)
      : "—";

    var notesPrev = "";
    if (lead.notes) {
      notesPrev =
        lead.notes.length > 60 ? lead.notes.slice(0, 60) + "…" : lead.notes;
    }

    return (
      '<div class="lead-row' +
      (overdue ? " overdue" : "") +
      '" data-id="' +
      lead.id +
      '">' +
      '<div class="col-name">' +
      '<div class="lead-name">' +
      escapeHtml(lead.name) +
      "</div>" +
      '<div class="lead-contact">' +
      escapeHtml(lead.contact_number) +
      "</div>" +
      (notesPrev
        ? '<div class="notes-preview">' + escapeHtml(notesPrev) + "</div>"
        : "") +
      "</div>" +
      '<div class="col-source lead-source">' +
      escapeHtml(lead.source) +
      "</div>" +
      '<div class="col-value lead-value">' +
      formatCurrency(lead.deal_value) +
      "</div>" +
      '<div class="col-priority">' +
      priorityBadge(lead.priority) +
      "</div>" +
      '<div class="col-status">' +
      statusBadge(lead.status) +
      "</div>" +
      '<div class="col-contact lead-contact-info">' +
      daysSinceText(lead.days_since_contact) +
      "</div>" +
      '<div class="col-followup lead-followup ' +
      followupClass +
      '">' +
      followupContent +
      "</div>" +
      '<div class="col-actions lead-actions">' +
      '<button type="button" class="action-btn" data-action="view" data-id="' +
      lead.id +
      '" title="View" aria-label="View lead">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
      "</button>" +
      '<button type="button" class="action-btn" data-action="edit" data-id="' +
      lead.id +
      '" title="Edit" aria-label="Edit lead">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
      "</button>" +
      '<button type="button" class="action-btn danger" data-action="delete" data-id="' +
      lead.id +
      '" title="Delete" aria-label="Delete lead">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
      "</button>" +
      "</div></div>"
    );
  }

  // Lead Modal (Add / Edit)
  function openLeadModal(id) {
    editingId = id || null;
    var form = $("#leadForm");
    if (form) form.reset();
    clearFormErrors();
    var title = $("#modalTitle");
    var saveText = $("#modalSave .btn-text");
    if (title) title.textContent = id ? "Edit Lead" : "Add Lead";
    if (saveText) saveText.textContent = id ? "Update Lead" : "Save Lead";

    if (id) {
      var lead = masterLeads.find(function (l) {
        return l.id === id;
      });
      if (lead) {
        fillForm(lead);
      } else {
        api(API.leads + "/" + id)
          .then(function (res) {
            fillForm(res.data);
          })
          .catch(function () {
            showToast("Could not load lead", "error");
          });
      }
    }
    openModal($("#leadModal"));
    setTimeout(function () {
      var nameField = $("#fieldName");
      if (nameField) nameField.focus();
    }, 120);
  }

  function fillForm(lead) {
    if (!lead) return;
    var map = {
      fieldName: lead.name || "",
      fieldContact: lead.contact_number || "",
      fieldSource: lead.source || "",
      fieldValue: lead.deal_value != null ? lead.deal_value : "",
      fieldPriority: lead.priority || "Warm",
      fieldStatus: lead.status || "New",
      fieldLastContact: lead.last_contact_date || "",
      fieldFollowUp: lead.next_follow_up || "",
      fieldNotes: lead.notes || "",
    };
    Object.keys(map).forEach(function (id) {
      var el = $("#" + id);
      if (el) el.value = map[id];
    });
  }

  function clearFormErrors() {
    $$(".field-error").forEach(function (el) {
      el.textContent = "";
    });
  }

  function setFormLoading(loading) {
    var btn = $("#modalSave");
    if (!btn) return;
    btn.disabled = loading;
    var t = btn.querySelector(".btn-text");
    var l = btn.querySelector(".btn-loading");
    if (t) t.hidden = loading;
    if (l) l.hidden = !loading;
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    clearFormErrors();

    var payload = {
      name: ($("#fieldName") && $("#fieldName").value.trim()) || "",
      contact_number: ($("#fieldContact") && $("#fieldContact").value.trim()) || "",
      source: ($("#fieldSource") && $("#fieldSource").value) || "",
      deal_value: ($("#fieldValue") && $("#fieldValue").value) || "",
      priority: ($("#fieldPriority") && $("#fieldPriority").value) || "Warm",
      status: ($("#fieldStatus") && $("#fieldStatus").value) || "New",
      last_contact_date: ($("#fieldLastContact") && $("#fieldLastContact").value) || null,
      next_follow_up: ($("#fieldFollowUp") && $("#fieldFollowUp").value) || null,
      notes: ($("#fieldNotes") && $("#fieldNotes").value.trim()) || "",
    };

    var hasError = false;
    if (!payload.name) {
      var en = $("#errName");
      if (en) en.textContent = "Name is required";
      hasError = true;
    }
    if (!payload.contact_number) {
      var ec = $("#errContact");
      if (ec) ec.textContent = "Contact number is required";
      hasError = true;
    }
    if (!payload.source) {
      var es = $("#errSource");
      if (es) es.textContent = "Source is required";
      hasError = true;
    }
    if (payload.deal_value === "" || isNaN(Number(payload.deal_value))) {
      var ev = $("#errValue");
      if (ev) ev.textContent = "Enter a valid deal value";
      hasError = true;
    }
    if (hasError) return;

    setFormLoading(true);
    try {
      if (editingId) {
        var resUpdate = await api(API.leads + "/" + editingId, { method: "PUT", body: payload });
        if (resUpdate.data) {
          var updatedLead = resUpdate.data;
          var idx = masterLeads.findIndex(function (l) { return l.id === editingId; });
          if (idx !== -1) {
            masterLeads[idx] = updatedLead;
          } else {
            masterLeads.unshift(updatedLead);
          }
        }
        showToast("Lead updated successfully");
      } else {
        var resCreate = await api(API.leads, { method: "POST", body: payload });
        if (resCreate.data) {
          masterLeads.unshift(resCreate.data);
        }
        showToast("Lead added successfully");
      }
      closeModal($("#leadModal"));
      updateDynamicStatsAndBadges();
      renderCurrentView();
    } catch (err) {
      if (err.errors && Array.isArray(err.errors)) {
        err.errors.forEach(function (msg) {
          var lower = msg.toLowerCase();
          if (lower.indexOf("name") !== -1) {
            var a = $("#errName");
            if (a) a.textContent = msg;
          } else if (lower.indexOf("contact") !== -1) {
            var b = $("#errContact");
            if (b) b.textContent = msg;
          } else if (lower.indexOf("source") !== -1) {
            var c = $("#errSource");
            if (c) c.textContent = msg;
          } else if (lower.indexOf("deal") !== -1 || lower.indexOf("value") !== -1) {
            var d = $("#errValue");
            if (d) d.textContent = msg;
          } else {
            showToast(msg, "error");
          }
        });
      } else {
        showToast(err.message || "Failed to save lead", "error");
      }
    } finally {
      setFormLoading(false);
    }
  }

  // View Modal
  async function openViewModal(id) {
    viewingId = id;
    var lead = masterLeads.find(function (l) {
      return l.id === id;
    });
    if (!lead) {
      try {
        var res = await api(API.leads + "/" + id);
        lead = res.data;
      } catch (e) {
        showToast("Lead not found", "error");
        return;
      }
    }

    var title = $("#viewTitle");
    if (title) title.textContent = lead.name;

    var body = $("#viewBody");
    if (body) {
      body.innerHTML =
        '<div class="view-grid">' +
        '<div class="view-item"><label>Contact Number</label><div class="value">' +
        escapeHtml(lead.contact_number) +
        "</div></div>" +
        '<div class="view-item"><label>Source</label><div class="value">' +
        escapeHtml(lead.source) +
        "</div></div>" +
        '<div class="view-item"><label>Deal Value</label><div class="value">' +
        formatCurrency(lead.deal_value) +
        "</div></div>" +
        '<div class="view-item"><label>Priority</label><div class="value">' +
        priorityBadge(lead.priority) +
        "</div></div>" +
        '<div class="view-item"><label>Status</label><div class="value">' +
        statusBadge(lead.status) +
        "</div></div>" +
        '<div class="view-item"><label>Days Since Contact</label><div class="value">' +
        daysSinceText(lead.days_since_contact) +
        "</div></div>" +
        '<div class="view-item"><label>Last Contact Date</label><div class="value">' +
        formatDate(lead.last_contact_date) +
        "</div></div>" +
        '<div class="view-item"><label>Next Follow-up</label><div class="value ' +
        (lead.is_overdue ? "overdue-date" : "") +
        '">' +
        (lead.is_overdue ? '<span class="badge badge-overdue">OVERDUE</span> ' : "") +
        formatDate(lead.next_follow_up) +
        "</div></div>" +
        '<div class="view-item"><label>Created</label><div class="value">' +
        formatDate(lead.created_at && lead.created_at.slice(0, 10)) +
        "</div></div>" +
        '<div class="view-item"><label>Updated</label><div class="value">' +
        formatDate(lead.updated_at && lead.updated_at.slice(0, 10)) +
        "</div></div>" +
        '<div class="view-item full"><label>Notes</label><div class="view-notes">' +
        (lead.notes ? escapeHtml(lead.notes) : "No notes yet.") +
        "</div></div>" +
        "</div>";
    }
    openModal($("#viewModal"));
  }

  // Delete Modal
  function openDeleteModal(id) {
    deletingId = id;
    var lead = masterLeads.find(function (l) {
      return l.id === id;
    });
    var nameEl = $("#deleteLeadName");
    if (nameEl) nameEl.textContent = lead ? lead.name : "Lead #" + id;
    openModal($("#deleteModal"));
  }

  function setDeleteLoading(loading) {
    var btn = $("#deleteConfirm");
    if (!btn) return;
    btn.disabled = loading;
    var t = btn.querySelector(".btn-text");
    var l = btn.querySelector(".btn-loading");
    if (t) t.hidden = loading;
    if (l) l.hidden = !loading;
  }

  async function confirmDelete() {
    if (!deletingId) return;
    setDeleteLoading(true);
    try {
      await api(API.leads + "/" + deletingId, { method: "DELETE" });
      masterLeads = masterLeads.filter(function (l) { return l.id !== deletingId; });
      showToast("Lead deleted");
      closeModal($("#deleteModal"));
      deletingId = null;
      updateDynamicStatsAndBadges();
      renderCurrentView();
    } catch (e) {
      showToast(e.message || "Failed to delete", "error");
    } finally {
      setDeleteLoading(false);
    }
  }

  // Clear filters
  function clearFilters() {
    currentStatus = "All";
    currentPriority = "All";
    currentSearch = "";
    var search = $("#searchInput");
    if (search) search.value = "";
    var clearBtn = $("#searchClear");
    if (clearBtn) clearBtn.hidden = true;
    $$("#statusFilters .filter-btn").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-status") === "All");
    });
    $$("#priorityFilters .filter-btn").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-priority") === "All");
    });
    renderCurrentView();
  }

  // ========== Event Delegation ==========
  function initEvents() {
    // Click handler for buttons and tabs
    document.addEventListener("click", function (e) {
      var t = e.target;

      // Add Lead button
      if (t.closest("#btnAddLead")) {
        e.preventDefault();
        openLeadModal(null);
        return;
      }

      // Empty state button
      if (t.closest("#emptyAddBtn")) {
        e.preventDefault();
        var hasFilters =
          currentStatus !== "All" || currentPriority !== "All" || !!currentSearch;
        if (hasFilters) clearFilters();
        else openLeadModal(null);
        return;
      }

      // Status filter button (Instant 0ms switch)
      var statusBtn = t.closest("#statusFilters .filter-btn");
      if (statusBtn) {
        e.preventDefault();
        $$("#statusFilters .filter-btn").forEach(function (b) {
          b.classList.remove("active");
        });
        statusBtn.classList.add("active");
        currentStatus = statusBtn.getAttribute("data-status") || "All";
        renderCurrentView();
        return;
      }

      // Priority filter button (Instant 0ms switch)
      var priBtn = t.closest("#priorityFilters .filter-btn");
      if (priBtn) {
        e.preventDefault();
        $$("#priorityFilters .filter-btn").forEach(function (b) {
          b.classList.remove("active");
        });
        priBtn.classList.add("active");
        currentPriority = priBtn.getAttribute("data-priority") || "All";
        renderCurrentView();
        return;
      }

      // Action buttons (view / edit / delete)
      var actionBtn = t.closest("[data-action]");
      if (actionBtn) {
        e.preventDefault();
        e.stopPropagation();
        var id = Number(actionBtn.getAttribute("data-id"));
        var action = actionBtn.getAttribute("data-action");
        if (action === "view") openViewModal(id);
        else if (action === "edit") openLeadModal(id);
        else if (action === "delete") openDeleteModal(id);
        return;
      }

      // Click on lead row (not on interactive button)
      var row = t.closest(".lead-row");
      if (row && !t.closest("button")) {
        var rid = Number(row.getAttribute("data-id"));
        if (rid) openViewModal(rid);
        return;
      }

      // Modal close buttons
      if (t.closest("#modalClose") || t.closest("#modalCancel")) {
        closeModal($("#leadModal"));
        return;
      }
      if (t.closest("#viewClose") || t.closest("#viewCloseBtn")) {
        closeModal($("#viewModal"));
        return;
      }
      if (t.closest("#viewEditBtn")) {
        closeModal($("#viewModal"));
        if (viewingId) openLeadModal(viewingId);
        return;
      }
      if (t.closest("#deleteClose") || t.closest("#deleteCancel")) {
        closeModal($("#deleteModal"));
        return;
      }
      if (t.closest("#deleteConfirm")) {
        confirmDelete();
        return;
      }

      // Click outside modal to close
      if (t.id === "leadModal") closeModal($("#leadModal"));
      if (t.id === "viewModal") closeModal($("#viewModal"));
      if (t.id === "deleteModal") closeModal($("#deleteModal"));

      // Search clear button
      if (t.closest("#searchClear")) {
        var si = $("#searchInput");
        if (si) si.value = "";
        var sc = $("#searchClear");
        if (sc) sc.hidden = true;
        currentSearch = "";
        renderCurrentView();
        return;
      }
    });

    // Form submit
    var form = $("#leadForm");
    if (form) {
      form.addEventListener("submit", handleFormSubmit);
    }

    // Search input (instant client-side filter)
    var searchInput = $("#searchInput");
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        var val = searchInput.value.trim();
        var clearBtn = $("#searchClear");
        if (clearBtn) clearBtn.hidden = !val;
        currentSearch = val;
        renderCurrentView();
      });
    }

    // Sort select
    var sortSelect = $("#sortSelect");
    if (sortSelect) {
      sortSelect.addEventListener("change", function () {
        currentSort = sortSelect.value;
        renderCurrentView();
      });
    }

    // Theme select
    var themeSelect = $("#themeSelect");
    if (themeSelect) {
      themeSelect.addEventListener("change", function () {
        applyTheme(themeSelect.value);
      });
    }

    // Reset filters button
    var btnReset = $("#btnResetFilters");
    if (btnReset) {
      btnReset.addEventListener("click", function () {
        clearFilters();
        currentSort = "attention";
        var ss = $("#sortSelect");
        if (ss) ss.value = "attention";
        renderCurrentView();
      });
    }

    // Import handlers
    var btnImport = $("#btnImport");
    if (btnImport) btnImport.addEventListener("click", openImportModal);
    var importClose = $("#importClose");
    if (importClose) importClose.addEventListener("click", function () { closeModal($("#importModal")); });
    var importCancel = $("#importCancel");
    if (importCancel) importCancel.addEventListener("click", function () { closeModal($("#importModal")); });
    var importBrowse = $("#importBrowse");
    if (importBrowse) importBrowse.addEventListener("click", function () {
      var f = $("#importFile");
      if (f) f.click();
    });
    var importFile = $("#importFile");
    if (importFile) importFile.addEventListener("change", function () {
      if (importFile.files && importFile.files[0]) handleImportFile(importFile.files[0]);
    });
    var importDrop = $("#importDrop");
    if (importDrop) {
      importDrop.addEventListener("dragover", function (e) {
        e.preventDefault();
        importDrop.classList.add("dragover");
      });
      importDrop.addEventListener("dragleave", function () {
        importDrop.classList.remove("dragover");
      });
      importDrop.addEventListener("drop", function (e) {
        e.preventDefault();
        importDrop.classList.remove("dragover");
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleImportFile(e.dataTransfer.files[0]);
        }
      });
    }
    var importConfirmBtn = $("#importConfirm");
    if (importConfirmBtn) importConfirmBtn.addEventListener("click", confirmImport);
    var importBack = $("#importBack");
    if (importBack) importBack.addEventListener("click", function () {
      showImportStep("upload");
    });

    // Export dropdown
    var btnExport = $("#btnExport");
    var exportMenu = $("#exportMenu");
    if (btnExport && exportMenu) {
      btnExport.addEventListener("click", function (e) {
        e.stopPropagation();
        exportMenu.hidden = !exportMenu.hidden;
      });
      document.addEventListener("click", function () {
        if (exportMenu) exportMenu.hidden = true;
      });
      exportMenu.addEventListener("click", function (e) {
        e.stopPropagation();
        var btn = e.target.closest("[data-export]");
        if (!btn) return;
        exportMenu.hidden = true;
        var kind = btn.getAttribute("data-export");
        if (kind === "print") printLeads();
        else downloadExport(kind);
      });
    }

    // Escape key modal handler
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (isModalOpen($("#leadModal"))) closeModal($("#leadModal"));
        else if (isModalOpen($("#viewModal"))) closeModal($("#viewModal"));
        else if (isModalOpen($("#deleteModal"))) closeModal($("#deleteModal"));
        else if (isModalOpen($("#importModal"))) closeModal($("#importModal"));
      }
    });
  }

  // ===== Theme =====
  function applyTheme(mode) {
    mode = mode || "system";
    try { localStorage.setItem("lt_theme", mode); } catch (e) {}
    var resolved = mode;
    if (mode === "system") {
      resolved = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", resolved === "dark" ? "dark" : "light");
    var sel = $("#themeSelect");
    if (sel) sel.value = mode;
  }

  function initTheme() {
    var saved = "system";
    try { saved = localStorage.getItem("lt_theme") || "system"; } catch (e) {}
    applyTheme(saved);
    if (window.matchMedia) {
      try {
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
          var cur = "system";
          try { cur = localStorage.getItem("lt_theme") || "system"; } catch (e) {}
          if (cur === "system") applyTheme("system");
        });
      } catch (e) {}
    }
  }

  function updateResetButton() {
    var active =
      currentStatus !== "All" ||
      currentPriority !== "All" ||
      !!currentSearch ||
      currentSort !== "attention";
    var btn = $("#btnResetFilters");
    if (btn) btn.disabled = !active;
  }

  // ===== Import Flow =====
  var importPreviewData = null;

  function openImportModal() {
    importPreviewData = null;
    var f = $("#importFile");
    if (f) f.value = "";
    showImportStep("upload");
    openModal($("#importModal"));
  }

  function showImportStep(step) {
    var up = $("#importStepUpload");
    var prev = $("#importStepPreview");
    var res = $("#importStepResult");
    var conf = $("#importConfirm");
    var back = $("#importBack");
    if (up) up.hidden = step !== "upload";
    if (prev) prev.hidden = step !== "preview";
    if (res) res.hidden = step !== "result";
    if (conf) conf.hidden = step !== "preview";
    if (back) back.hidden = step !== "preview" && step !== "result";
  }

  async function handleImportFile(file) {
    if (!file) return;
    var form = new FormData();
    form.append("file", file);
    showToast("Analyzing file…");
    try {
      var res = await fetch("/api/import/preview", { method: "POST", body: form });
      var data = await res.json();
      if (!res.ok || !data.success) {
        showToast((data && data.error) || "Import preview failed", "error");
        return;
      }
      importPreviewData = data.data;
      renderImportPreview(data.data);
      showImportStep("preview");
    } catch (e) {
      showToast("Upload failed", "error");
    }
  }

  function renderImportPreview(d) {
    var sum = $("#importSummary");
    if (sum) {
      sum.innerHTML =
        '<div class="import-stat"><span>Total</span><strong>' + d.total_rows + "</strong></div>" +
        '<div class="import-stat valid"><span>Valid</span><strong>' + d.valid_rows + "</strong></div>" +
        '<div class="import-stat invalid"><span>Invalid</span><strong>' + d.invalid_rows + "</strong></div>" +
        '<div class="import-stat"><span>Duplicates</span><strong>' + d.duplicate_rows + "</strong></div>";
    }
    var mapEl = $("#importMapping");
    if (mapEl) {
      var html = "<p><strong>Column mapping</strong></p><table><thead><tr><th>App field</th><th>File column</th></tr></thead><tbody>";
      (d.app_columns || []).forEach(function (col) {
        var mapped = (d.auto_mapping && d.auto_mapping[col.key]) || "—";
        html += "<tr><td>" + escapeHtml(col.label) + (col.required ? " *" : "") + "</td><td>" + escapeHtml(String(mapped)) + "</td></tr>";
      });
      html += "</tbody></table>";
      if (d.missing_required && d.missing_required.length) {
        html += '<p style="color:var(--danger);margin-top:0.5rem">Missing required: ' + d.missing_required.join(", ") + "</p>";
      }
      if (d.extra_columns && d.extra_columns.length) {
        html += '<p style="color:var(--text-muted);margin-top:0.35rem">Extra columns ignored: ' + d.extra_columns.join(", ") + "</p>";
      }
      mapEl.innerHTML = html;
    }
    var table = $("#importPreviewTable");
    if (table) {
      var thead = table.querySelector("thead");
      var tbody = table.querySelector("tbody");
      thead.innerHTML = "<tr><th>#</th><th>Name</th><th>Contact</th><th>Value</th><th>Status</th><th>Errors</th></tr>";
      tbody.innerHTML = (d.preview || []).map(function (r) {
        return (
          '<tr class="' + (r.valid ? "" : "row-invalid") + '">' +
          "<td>" + r.row_number + "</td>" +
          "<td>" + escapeHtml(r.data.name) + "</td>" +
          "<td>" + escapeHtml(r.data.contact_number) + "</td>" +
          "<td>" + (r.data.deal_value != null ? r.data.deal_value : "") + "</td>" +
          "<td>" + escapeHtml(r.data.status) + "</td>" +
          "<td>" + escapeHtml((r.errors || []).join("; ")) + "</td></tr>"
        );
      }).join("");
    }
    var conf = $("#importConfirm");
    if (conf) conf.disabled = !d.valid_rows;
  }

  async function confirmImport() {
    if (!importPreviewData) return;
    var validRows = importPreviewData.valid_payload || (importPreviewData.preview || [])
      .filter(function (r) { return r.valid; })
      .map(function (r) { return r.data; });
    if (!validRows.length) {
      showToast("No valid rows to import", "error");
      return;
    }
    var btn = $("#importConfirm");
    if (btn) {
      btn.disabled = true;
      var t = btn.querySelector(".btn-text");
      var l = btn.querySelector(".btn-loading");
      if (t) t.hidden = true;
      if (l) l.hidden = false;
    }
    try {
      var res = await api("/api/import/confirm", { method: "POST", body: { rows: validRows } });
      var d = res.data;
      showImportStep("result");
      var resultEl = $("#importResult");
      if (resultEl) {
        resultEl.innerHTML =
          "<p><strong>Import complete</strong></p>" +
          "<p>Inserted: <strong>" + d.inserted + "</strong></p>" +
          "<p>Skipped: <strong>" + d.skipped + "</strong></p>";
      }
      showToast("Imported " + d.inserted + " leads");
      await fetchMasterLeads(true);
    } catch (e) {
      showToast(e.message || "Import failed", "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        var t2 = btn.querySelector(".btn-text");
        var l2 = btn.querySelector(".btn-loading");
        if (t2) t2.hidden = false;
        if (l2) l2.hidden = true;
      }
    }
  }

  // ===== Export =====
  function exportQuery() {
    var params = new URLSearchParams();
    if (currentStatus && currentStatus !== "All") params.set("status", currentStatus);
    if (currentPriority && currentPriority !== "All") params.set("priority", currentPriority);
    if (currentSearch) params.set("search", currentSearch);
    if (currentSort) params.set("sort", currentSort);
    return params.toString();
  }

  function downloadExport(fmt) {
    var q = exportQuery();
    var url = "/api/export?format=" + encodeURIComponent(fmt) + (q ? "&" + q : "");
    window.location.href = url;
    showToast("Downloading " + fmt.toUpperCase() + "…");
  }

  function printLeads() {
    var report = $("#printReport");
    if (!report) return;
    var rows = getFilteredAndSortedLeads();
    var filterParts = [];
    if (currentStatus !== "All") filterParts.push("Status: " + currentStatus);
    if (currentPriority !== "All") filterParts.push("Priority: " + currentPriority);
    if (currentSearch) filterParts.push('Search: "' + currentSearch + '"');
    var html =
      "<h1>Property in 5 Min — Lead Report</h1>" +
      '<div class="meta">Generated: ' + new Date().toLocaleString("en-IN") +
      (filterParts.length ? " · Filters: " + filterParts.join(", ") : " · All leads") +
      " · " + rows.length + " records</div>" +
      "<table><thead><tr>" +
      "<th>Name</th><th>Contact</th><th>Source</th><th>Value</th><th>Priority</th><th>Status</th><th>Follow-up</th>" +
      "</tr></thead><tbody>" +
      rows.map(function (l) {
        return (
          "<tr><td>" + escapeHtml(l.name) +
          "</td><td>" + escapeHtml(l.contact_number) +
          "</td><td>" + escapeHtml(l.source) +
          "</td><td>" + formatCurrency(l.deal_value) +
          "</td><td>" + escapeHtml(l.priority) +
          "</td><td>" + escapeHtml(l.status) +
          "</td><td>" + formatDate(l.next_follow_up) +
          "</td></tr>"
        );
      }).join("") +
      "</tbody></table>";
    report.innerHTML = html;
    report.hidden = false;
    window.print();
    setTimeout(function () { report.hidden = true; }, 500);
  }

  // Boot
  function boot() {
    initTheme();
    initEvents();
    refreshAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
