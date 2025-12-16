function initDonations() {
  if (DONATE_CONFIG.kofi) {
    document.getElementById('kofi-btn').href = DONATE_CONFIG.kofi;
  }

  var coins = ['btc', 'doge', 'eth'];
  coins.forEach(function(coin) {
    var cfg = DONATE_CONFIG[coin];
    if (cfg && cfg.address) {
      document.getElementById(coin + '-address').textContent = cfg.address;
      if (cfg.qr) {
        var qrEl = document.getElementById(coin + '-qr');
        var img = document.createElement('img');
        img.src = cfg.qr;
        img.alt = coin.toUpperCase() + ' QR';
        qrEl.textContent = '';
        qrEl.appendChild(img);
      }
    }
  });
}

document.querySelectorAll('.crypto-tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.crypto-tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.crypto-content').forEach(function(c) { c.classList.remove('active'); });
    tab.classList.add('active');
    document.getElementById('crypto-' + tab.dataset.crypto).classList.add('active');
  });
});

document.querySelectorAll('.copy-btn[data-coin]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var coin = btn.dataset.coin;
    var address = document.getElementById(coin + '-address').textContent;
    navigator.clipboard.writeText(address).then(function() {
      var original = btn.textContent;
      btn.textContent = 'Kopiert!';
      setTimeout(function() { btn.textContent = original; }, 2000);
    });
  });
});

initDonations();
