chrome.runtime.onInstalled.addListener(() => {
  // No-op: reserved for future migration hooks.
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("index.html#/dashboard"),
  });
});
