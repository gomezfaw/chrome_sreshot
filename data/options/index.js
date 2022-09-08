"use strict";

const toast = document.getElementById("toast");

function restore() {
  chrome.storage.local.get(
    {
      delay: 600,
      offset: 50,
      timestamp: true,
      saveAs: false,
    },
    (prefs) => {
      document.getElementById("delay").value = prefs.delay;
      document.getElementById("offset").value = prefs.offset;
      document.getElementById("timestamp").checked = prefs.timestamp;
    }
  );
}

function save() {
  const delay = Math.max(document.getElementById("delay").value, 100);
  const offset = Math.max(document.getElementById("offset").value, 10);
  const timestamp = document.getElementById("timestamp").checked;

  chrome.storage.local.set(
    {
      delay,
      offset,
      timestamp,
    },
    () => {
      toast.textContent = "Options saved.";
      setTimeout(() => (toast.textContent = ""), 2000);
      restore();
    }
  );
}

document.addEventListener("DOMContentLoaded", restore);
document.getElementById("save").addEventListener("click", save);

// reset
document.getElementById("reset").addEventListener("click", (e) => {
  if (e.detail === 1) {
    toast.textContent = "Double-click to reset!";
    window.setTimeout(() => (toast.textContent = ""), 2000);
  } else {
    localStorage.clear();
    chrome.storage.local.clear(() => {
      chrome.runtime.reload();
      window.close();
    });
  }
});
