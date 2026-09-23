// legalPages.js
// -----------------------------------------------------------------------
// Gizlilik politikasi sayfasi. Google Play Console (ve App Store Connect)
// uygulamayi yayinlamadan once HERKESE ACIK, giris gerektirmeyen bir
// gizlilik politikasi URL'si istiyor -- bu yuzden bunu ayri bir sayfa
// olarak degil, dogrudan bu (zaten canli/public olan) backend'in bir
// route'u olarak sunuyoruz: https://firsatradar-render.onrender.com/privacy
// Boylece Play Console'un otomatik inceleme sistemi (ve herkes) giris
// yapmadan gorebilir.
const PRIVACY_HTML = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>FırsatRadar — Gizlilik Politikası</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 0;
    background: #0B0F17; color: #F4F7FB;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
    line-height: 1.65;
  }
  main { max-width: 720px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font-size: 26px; margin-bottom: 4px; }
  .updated { color: #9AA8BB; font-size: 13px; margin-bottom: 32px; }
  h2 { font-size: 18px; margin-top: 36px; color: #FF6B00; }
  p, li { color: #E8EDF5; font-size: 15px; }
  ul { padding-left: 20px; }
  a { color: #3BB9FF; }
  .contact {
    margin-top: 40px; padding: 16px 18px; border-radius: 12px;
    background: #111925; border: 1px solid #263247;
  }
</style>
</head>
<body>
<main>
  <h1>FırsatRadar — Gizlilik Politikası</h1>
  <p class="updated">Son güncelleme: 23 Eylül 2026</p>

  <p>
    Bu gizlilik politikası, FırsatRadar mobil uygulamasının (bundan sonra
    "Uygulama") kullanıcılarından hangi verileri, hangi amaçla topladığını
    ve bu verilerin nasıl işlendiğini açıklar. Uygulama, Trendyol,
    Hepsiburada, N11, Çiçeksepeti gibi mağazalardaki indirimleri ve genel
    kanallardaki fırsat duyurularını bir araya getiren, ücretsiz ve
    reklamla desteklenen bir fırsat/indirim takip uygulamasıdır.
  </p>

  <h2>1. Topladığımız veriler</h2>
  <ul>
    <li>
      <strong>Hesap bilgileri (isteğe bağlı):</strong> Uygulamayı hesap
      oluşturmadan da ("misafir" olarak) kullanabilirsiniz. Hesap
      oluşturursanız e-posta adresinizi ve şifrenizi alırız; şifreniz asla
      düz metin olarak saklanmaz, geri döndürülemez şekilde
      (hash'lenerek) saklanır.
    </li>
    <li>
      <strong>Cihaz tanımlayıcısı:</strong> Hesap oluşturmadan kullanırsanız,
      fiyat alarmlarınızı cihazınıza bağlamak için cihazınızda rastgele
      üretilen, kimliğinizi içermeyen bir tanımlayıcı saklanır.
    </li>
    <li>
      <strong>Fiyat alarmı verisi:</strong> Takip etmeyi seçtiğiniz ürünler
      ve belirlediğiniz hedef fiyatlar.
    </li>
    <li>
      <strong>Reklamlar:</strong> Uygulama, reklamları Google AdMob
      aracılığıyla gösterir. Kişiselleştirilmemiş reklam talep ederiz,
      ancak Google'ın reklam sunumu ve dolandırıcılık önleme amacıyla
      cihaz reklam kimliği gibi teknik verileri işlemesi mümkündür. Bu
      veriler Google'ın kendi
      <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">gizlilik politikasına</a>
      tabidir.
    </li>
  </ul>

  <h2>2. Verileri nasıl kullanıyoruz</h2>
  <p>
    Topladığımız veriler yalnızca hesabınızı yönetmek, fiyat alarmlarınızı
    çalıştırmak, size ilgili fırsatları göstermek ve uygulamayı
    geliştirmek için kullanılır. Verileriniz üçüncü taraflara satılmaz.
  </p>

  <h2>3. Veri paylaşımı</h2>
  <p>
    Verileriniz, reklam sunumu için Google AdMob dışında hiçbir üçüncü
    tarafla paylaşılmaz. Sunucularımız Render.com altyapısında barındırılır.
  </p>

  <h2>4. Veri güvenliği ve saklama</h2>
  <p>
    Şifreler geri döndürülemez şekilde hash'lenerek saklanır. Hesap ve
    alarm verileriniz, hesabınızı silene ya da silinmesini talep edene
    kadar sunucularımızda saklanır.
  </p>

  <h2>5. Haklarınız</h2>
  <p>
    Hesabınızın ve ilişkili verilerinizin silinmesini
    <a href="/hesap-silme">bu sayfadan</a> kendiniz talep edebilir, ya da
    aşağıdaki iletişim adresinden bize ulaşabilirsiniz.
  </p>

  <h2>6. Çocukların gizliliği</h2>
  <p>
    Uygulama 13 yaşından küçük kullanıcılara yönelik değildir ve bu yaş
    grubundan bilerek veri toplamayız.
  </p>

  <h2>7. Bu politikadaki değişiklikler</h2>
  <p>
    Bu politikayı zaman zaman güncelleyebiliriz; önemli değişiklikler bu
    sayfada yayınlanır.
  </p>

  <div class="contact">
    <strong>İletişim:</strong><br />
    Sorularınız veya veri silme talepleriniz için:
    <a href="mailto:seolen8@gmail.com">seolen8@gmail.com</a>
  </div>
</main>
</body>
</html>`;

// -----------------------------------------------------------------------
// Hesap silme sayfasi. Google Play (App Content > Data safety) yayin
// oncesi, uygulamayi silmis olsalar bile kullanicilarin hesap/veri silme
// TALEP edebilecekleri herkese acik bir URL istiyor. Bu sayfa gercek bir
// kendi-kendine-hizmet formu: e-posta+sifresini giren kullanicinin hesabi
// ve ona bagli TUM fiyat alarmlari POST /api/auth/delete-account uzerinden
// aninda ve kalici olarak silinir (bkz. routes/auth.js) -- sadece "bize
// yazin" diyen pasif bir aciklama degil.
const ACCOUNT_DELETION_HTML = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>FırsatRadar — Hesap Silme</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 0;
    background: #0B0F17; color: #F4F7FB;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
    line-height: 1.65;
  }
  main { max-width: 560px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font-size: 26px; margin-bottom: 4px; }
  .updated { color: #9AA8BB; font-size: 13px; margin-bottom: 28px; }
  h2 { font-size: 16px; margin-top: 30px; color: #FF6B00; }
  p, li { color: #E8EDF5; font-size: 15px; }
  ol { padding-left: 20px; }
  a { color: #3BB9FF; }
  label { display: block; margin-top: 16px; font-size: 13px; font-weight: 600; }
  input {
    width: 100%; box-sizing: border-box; margin-top: 6px;
    padding: 12px 14px; border-radius: 10px; border: 1px solid #263247;
    background: #172131; color: #F4F7FB; font-size: 15px;
  }
  button {
    width: 100%; margin-top: 22px; padding: 14px; border: none; border-radius: 12px;
    background: #FF5C6C; color: #26070C; font-size: 15px; font-weight: 700;
    cursor: pointer;
  }
  button:disabled { opacity: 0.6; cursor: default; }
  #status { margin-top: 16px; font-size: 14px; font-weight: 600; }
  #status.ok { color: #72F3A1; }
  #status.err { color: #FF5C6C; }
  .contact {
    margin-top: 40px; padding: 16px 18px; border-radius: 12px;
    background: #111925; border: 1px solid #263247; font-size: 14px;
  }
</style>
</head>
<body>
<main>
  <h1>FırsatRadar — Hesap Silme</h1>
  <p class="updated">Geliştirici: Burak — FırsatRadar</p>

  <p>
    Bu sayfadan FırsatRadar hesabınızı ve hesabınıza bağlı tüm verilerinizi
    kalıcı olarak silebilirsiniz — uygulamayı telefonunuzdan kaldırmış
    olsanız bile.
  </p>

  <h2>Adımlar</h2>
  <ol>
    <li>Hesabınıza ait e-posta ve şifreyi aşağıya girin.</li>
    <li>"Hesabımı ve Verilerimi Sil" butonuna basın.</li>
    <li>Onaylayın — hesabınız aynı anda silinir, geri alınamaz.</li>
  </ol>

  <h2>Ne silinir, ne kadar saklanır</h2>
  <p>
    Hesap bilgileriniz (e-posta, şifrenizin hash'i) ve hesabınıza bağlı
    <strong>tüm fiyat alarmlarınız</strong> talebiniz anında veritabanından
    tamamen silinir. Hiçbir yedek veya arşiv kopyası tutulmaz.
  </p>
  <p>
    Hesap oluşturmadan, yalnızca cihazınıza bağlı (misafir) olarak
    kullandıysanız zaten hiçbir sunucu tarafı hesap verisi yoktur;
    uygulamayı cihazınızdan kaldırmanız verilerinizi siler.
  </p>

  <form id="deleteForm">
    <label for="email">E-posta</label>
    <input id="email" type="email" autocomplete="username" required />

    <label for="password">Şifre</label>
    <input id="password" type="password" autocomplete="current-password" required />

    <button id="submitBtn" type="submit">Hesabımı ve Verilerimi Sil</button>
    <div id="status" role="status"></div>
  </form>

  <div class="contact">
    Bu formu kullanamıyorsanız, aynı talebi
    <a href="mailto:seolen8@gmail.com">seolen8@gmail.com</a> adresine
    e-posta göndererek de iletebilirsiniz.
  </div>
</main>
<script>
  var form = document.getElementById('deleteForm');
  var statusEl = document.getElementById('status');
  var btn = document.getElementById('submitBtn');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = document.getElementById('email').value.trim();
    var password = document.getElementById('password').value;

    if (!confirm('Bu islem GERI ALINAMAZ. Hesabinizi ve tum verilerinizi silmek istediginizden emin misiniz?')) {
      return;
    }

    btn.disabled = true;
    statusEl.className = '';
    statusEl.textContent = 'Siliniyor...';

    fetch('/api/auth/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) throw new Error(body && body.error ? body.error : 'Bir hata olustu.');
          return body;
        });
      })
      .then(function () {
        statusEl.className = 'ok';
        statusEl.textContent = 'Hesabiniz ve tum verileriniz kalici olarak silindi.';
        form.reset();
      })
      .catch(function (err) {
        statusEl.className = 'err';
        statusEl.textContent = err.message || 'Bir hata olustu, tekrar deneyin.';
      })
      .finally(function () {
        btn.disabled = false;
      });
  });
</script>
</body>
</html>`;

function renderPrivacyPolicy(req, res) {
  res.type('html').send(PRIVACY_HTML);
}

function renderAccountDeletionPage(req, res) {
  res.type('html').send(ACCOUNT_DELETION_HTML);
}

module.exports = { renderPrivacyPolicy, renderAccountDeletionPage };
