const GDRIVE_BASE_URL = "https://drive.google.com/uc?id=";
/* global ClipboardItem */
("use strict");

chrome.runtime.onConnect.addListener((p) => {
  p.onDisconnect.addListener(() => {
    console.log("port is closed", p.name);
  });
});

const notify = (e) =>
  chrome.notifications.create({
    type: "basic",
    iconUrl: "/data/icons/128x128.png",
    title: chrome.runtime.getManifest().name,
    message: e.message || e,
  });

function testOauth() {
  chrome.identity.getAuthToken({ interactive: true }, function (token) {
    console.log("testOauth: " + token);
  });
}

function capture(request) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        return reject(lastError);
      }

      if (!request) {
        return fetch(dataUrl)
          .then((r) => r.blob())
          .then(resolve, reject);
      }

      const left = request.left * request.devicePixelRatio;
      const top = request.top * request.devicePixelRatio;
      const width = request.width * request.devicePixelRatio;
      const height = request.height * request.devicePixelRatio;

      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");

      fetch(dataUrl)
        .then((r) => r.blob())
        .then(async (blob) => {
          const prefs = await new Promise((resolve) =>
            chrome.storage.local.get(
              {
                quality: 0.95,
              },
              resolve
            )
          );

          const img = await createImageBitmap(blob);

          if (width && height) {
            ctx.drawImage(img, left, top, width, height, 0, 0, width, height);
          } else {
            ctx.drawImage(img, 0, 0);
          }
          resolve(
            await canvas.convertToBlob({
              type: "image/png",
              quality: prefs.quality,
            })
          );
        })
        .catch(reject);
    });
  });
}

function save(blob, tab) {
  chrome.storage.local.get(
    {
      timestamp: true,
      "save-disk": true,
      "save-clipboard": false,
    },
    (prefs) => {
      let filename = tab.title;
      if (prefs.timestamp) {
        const time = new Date();
        filename = filename +=
          " " + time.toLocaleDateString() + " " + time.toLocaleTimeString();
      }

      const reader = new FileReader();
      reader.onload = () => {
        // save to gdrive
        uploadFileToDrive(filename, "image/png", blob, tab);
        // save to clipboard
        if (prefs["save-clipboard"]) {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: async (href) => {
              try {
                const blob = await fetch(href).then((r) => r.blob());
                await navigator.clipboard.write([
                  new ClipboardItem({
                    "image/png": blob,
                  }),
                ]);
              } catch (e) {
                console.warn(e);
                alert(e.message);
              }
            },
            args: [reader.result],
          });
        }
        // save to disk
        if (prefs["save-disk"] || prefs["save-clipboard"] === false) {
          chrome.downloads.download(
            {
              url: reader.result,
              filename: filename + ".png",
              saveAs: false,
            },
            () => {
              const lastError = chrome.runtime.lastError;
              if (lastError) {
                chrome.downloads.download(
                  {
                    url: reader.result,
                    filename:
                      filename.replace(
                        /[`~!@#$%^&*()_|+\-=?;:'",.<>{}[\]\\/]/gi,
                        "-"
                      ) + ".png",
                  },
                  () => {
                    const lastError = chrome.runtime.lastError;
                    if (lastError) {
                      chrome.downloads.download({
                        url: reader.result,
                        filename: "image.png",
                      });
                    }
                  }
                );
              }
            }
          );
        }
      };
      reader.readAsDataURL(blob);
    }
  );
}

async function matrix(tab) {
  const tabId = tab.id;
  const prefs = await new Promise((resolve) =>
    chrome.storage.local.get(
      {
        delay: 600,
        offset: 50,
        quality: 0.95,
      },
      resolve
    )
  );
  prefs.delay = Math.max(
    prefs.delay,
    1000 / chrome.tabs.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND || 2
  );

  const r = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      self.port = chrome.runtime.connect({
        name: "matrix",
      });

      return {
        width: Math.max(
          document.body.scrollWidth,
          document.documentElement.scrollWidth
        ),
        height: Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight
        ),
        w: document.documentElement.clientWidth,
        h: document.documentElement.clientHeight,
        ratio: window.devicePixelRatio,
      };
    },
  });
  const { ratio, width, height, w, h } = r[0].result;
  const canvas = new OffscreenCanvas(width * ratio, height * ratio);
  const ctx = canvas.getContext("2d");

  chrome.action.setBadgeText({ tabId, text: "R" });

  const mx =
    Math.ceil((width - prefs.offset) / (w - prefs.offset)) *
    Math.ceil((height - prefs.offset) / (h - prefs.offset));
  let p = 0;

  for (let x = 0; x < width - prefs.offset; x += w - prefs.offset) {
    for (let y = 0; y < height - prefs.offset; y += h - prefs.offset) {
      p += 1;
      chrome.action.setBadgeText({
        tabId,
        text: ((p / mx) * 100).toFixed(0) + "%",
      });

      // move to the location
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (x, y) => window.scroll(x, y),
        args: [x, y],
      });
      // wait
      await new Promise((resolve) => setTimeout(resolve, prefs.delay));
      // read with delay
      const [
        {
          result: [i, j],
        },
      ] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => [
          document.body.scrollLeft || document.documentElement.scrollLeft,
          document.body.scrollTop || document.documentElement.scrollTop,
        ],
      });

      // capture
      await chrome.tabs.update(tabId, {
        highlighted: true,
      });
      await chrome.windows.update(tab.windowId, {
        focused: true,
      });

      const blob = await capture();
      // write
      const img = await createImageBitmap(blob);
      ctx.drawImage(
        img,
        0,
        0,
        img.width,
        img.height,
        i * ratio,
        j * ratio,
        img.width,
        img.height
      );
    }
  }
  chrome.action.setBadgeText({ tabId, text: "Wait..." });
  const blob = await canvas.convertToBlob({
    type: "image/png",
    quality: prefs.quality,
  });
  chrome.action.setBadgeText({ tabId, text: "" });
  chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      try {
        self.port.disconnect();
      } catch (e) {}
    },
  });
  return blob;
}

{
  const once = () => {
    chrome.contextMenus.create({
      id: "capture-portion",
      title: "Capture area",
      contexts: ["page", "selection", "link"],
    });
    chrome.contextMenus.create({
      id: "capture-visual",
      title: "Capture current view",
      contexts: ["page", "selection", "link"],
    });
    chrome.contextMenus.create({
      id: "capture-entire",
      title: "Capture full page",
      contexts: ["page", "selection", "link"],
    });
  };
  if (chrome.runtime && chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(once);
  } else {
    once();
  }
}

function readDummyFile() {
  console.log("Intentando conseguir datos");
  chrome.identity.getAuthToken({ interactive: true }, (token) => {
    let driveUrl =
      "https://www.googleapis.com/drive/v3/files/17oMrHEViGtAz6O5pIrBBf5pbdnN36ZHbyPXmXUUG_8ueI0cyGQ?alt=media&supportsAllDrives=true";
    let init = {
      method: "GET",
      async: true,
      headers: {
        Authorization: "Bearer " + token,
      },
    };
    fetch(driveUrl, init)
      .then((response) => response.json())
      .then(function (data) {
        console.log("Termino el fetch!!!!");
        console.log(data);
      });
  });
}

function uploadFileToDrive(fileName, mimeType, fileBlob, tab) {
  chrome.identity.getAuthToken({ interactive: true }, (token) => {
    var form = new FormData();
    var metadata = {
      name: fileName,
      mimeType: mimeType,
      parents: ["1xGtS8EDhPulS5uMdAF84jk_Y-AhUpyxU"], // Folder Id to save in shared drive
      driveId: "0ACf2_N8eJLziUk9PVA", //shared drive id
    };

    form.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" })
    );
    form.append("file", fileBlob);
    let driveUrl =
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";
    let init = {
      method: "POST",
      async: false,
      headers: {
        Authorization: "Bearer " + token,
      },
      body: form,
    };
    fetch(driveUrl, init)
      .then((response) => response.json())
      .then(function (data) {
        console.log("Termino subida de imagen!!!");
        // console.log(data.id);
        urlImgDataDog = GDRIVE_BASE_URL + data.id;
        console.log("Url Para datadog: " + urlImgDataDog);
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: async (href) => {
            console.log("inicio funcion asincrona copia clipboard");
            console.log(href);
            try {
              await navigator.clipboard.writeText(href);
            } catch (e) {
              console.warn(e);
              alert(e.message);
            }
          },
          args: [urlImgDataDog],
        });
      });
  });
}

function createDummyFile() {
  console.log("Intentando conseguir token 2");
  chrome.identity.getAuthToken({ interactive: true }, (token) => {
    var form = new FormData();
    var metadata = {
      name: "foo-bar-new2.json",
      mimeType: "application/json",
      // parents: ["appDataFolder"],
      parents: ["1xGtS8EDhPulS5uMdAF84jk_Y-AhUpyxU"],
      driveId: "0ACf2_N8eJLziUk9PVA",
    };
    var fileContent = {
      foo: "bar",
    };
    var file = new Blob([JSON.stringify(fileContent)], {
      type: "application/json",
    });

    form.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" })
    );
    form.append("file", file);
    let driveUrl =
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";
    let init = {
      method: "POST",
      async: true,
      headers: {
        Authorization: "Bearer " + token,
      },
      body: form,
    };
    fetch(driveUrl, init)
      .then((response) => response.json())
      .then(function (data) {
        console.log("Termino el fetch a directorio!!!!");
        console.log(data);
      });

    /*
    var xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"
    );
    xhr.setRequestHeader("Authorization", "Bearer " + token);
    xhr.responseType = "json";
    xhr.onload = () => {
      var fileId = xhr.response.id;
      console.log(fileId);
      /* Do something with xhr.response */
    /*};
    xhr.send(form);*/
  });
}

function onCommand(cmd, tab) {
  // createDummyFile();
  // testOauth();
  // readDummyFile();
  if (cmd === "capture-visual") {
    capture()
      .then((blob) => save(blob, tab))
      .catch((e) => {
        console.warn(e);
        notify(e.message || e);
      });
  } else if (cmd === "capture-portion") {
    chrome.scripting.insertCSS(
      {
        target: { tabId: tab.id },
        files: ["data/inject/inject.css"],
      },
      () => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          return notify(lastError);
        }
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["data/inject/inject.js"],
        });
      }
    );
  } else if (cmd === "capture-entire") {
    matrix(tab)
      .then((a) => save(a, tab))
      .catch((e) => {
        console.warn(e);
        notify(e.message || e);
      });
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  onCommand(info.menuItemId, tab);
});

chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.method === "captured") {
    capture(request)
      .then((a) => save(a, sender.tab))
      .catch((e) => {
        console.warn(e);
        notify(e.message || e);
      });
  }
  if (request.method === "popup") {
    onCommand(request.cmd, request.tab);

    response(true);
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "captureArea") {
    let captureTab = {
      id: tab.id,
      title: tab.title,
      windowId: tab.windowId,
    };
    onCommand("capture-portion", captureTab);
  }
});
