window.dataLayer = window.dataLayer || [];
function gtag() {
  window.dataLayer.push(arguments);
}
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
  wait_for_update: 500,
});

(function () {
  var root = document.documentElement;
  if (root) {
    var ga4 = root.getAttribute('data-ga4-id');
    var ads = root.getAttribute('data-ads-client-id');
    window.__11kaGa4Id = ga4 && ga4 !== '' ? ga4 : null;
    window.__11kaAdsClientId = ads && ads !== '' ? ads : null;
  }

  var fontLink = document.getElementById('google-fonts-inter');
  if (fontLink) fontLink.media = 'all';
})();
