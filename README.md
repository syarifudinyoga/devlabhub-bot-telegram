# DevLabHub Telegram Bot

Endpoint HTTP untuk mengirim pesan teks melalui Telegram Bot API. Telegram
mengirim pesan ke `chat_id`, bukan nomor telepon. Penerima harus membuka bot
dan mengirim `/start` terlebih dahulu.

## Menyiapkan bot

1. Buat bot melalui [@BotFather](https://t.me/BotFather), atur namanya menjadi
   **DevLabHub** dengan `/setname`, lalu simpan token bot dengan aman.
2. Salin `.env.example` menjadi `.env`. Isi `API_KEY` dengan secret acak minimal
   16 karakter dan `TELEGRAM_BOT_TOKEN` dengan token dari BotFather. Jangan
   bagikan token atau file `.env`.
3. Jalankan server dengan `npm start`, lalu buka chat bot dan kirim `/start`.
   Bot membalas sapaan personal. Di chat pribadi, sapaan menampilkan nama,
   username jika tersedia, user ID, chat ID, dan kode bahasa yang dibagikan
   Telegram. Di grup bot hanya menyapa dengan nama. Telegram tidak memberikan
   nomor telepon atau email lewat `/start`.

## Menjalankan

Membutuhkan Node.js 20.6 atau lebih baru:

```sh
npm start
```

Server berjalan di port `3006` secara default.
Endpoint pemeriksaan status: `GET /health`. Saat berjalan, bot memantau pesan
masuk dan membalas `/start` otomatis.

## Mengirim pesan

Kirim `POST /send` dengan autentikasi Bearer. Tujuan wajib ditentukan untuk
setiap request melalui `chat_id` di payload atau header `X-Telegram-Chat-Id`.
Prioritasnya: payload, lalu header. Tidak ada penerima default di `.env`.

Contoh dari terminal kedua (header memakai `API_KEY` dari `.env`, bukan token
Telegram bot):

```sh
set -a && source .env && set +a
curl http://localhost:3006/send \
  -H "Authorization: Bearer $API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"type":"text","chat_id":"CHAT_ID_TUJUAN","message":"Pesanan baru masuk!"}'
```

Atau tentukan penerima lewat header:

```sh
curl http://localhost:3006/send \
  -H "Authorization: Bearer $API_KEY" \
  -H 'X-Telegram-Chat-Id: CHAT_ID_TUJUAN' \
  -H 'Content-Type: application/json' \
  -d '{"type":"text","message":"Pesanan baru masuk!"}'
```

`type` saat ini harus `"text"`. `parse_mode` (`HTML`, `Markdown`, atau
`MarkdownV2`) dan `disable_notification` (boolean) bersifat opsional. Balasan
sukses berisi `message_id` dan `chat_id`; kegagalan Telegram menghasilkan
status `502`.

## Deploy lewat Jenkins dan Podman

Pipeline di `Jenkinsfile` mengambil source dari Git (`checkout scm`), menjalankan
tes, membangun image multi-arsitektur, mengirimkannya ke GHCR, lalu server
DevLabHub menarik image dengan Podman. Image bertag nomor build, jadi versi
rilis sebelumnya tetap tersedia.

### Persiapan Jenkins

1. Buat Jenkins Pipeline job dengan **Pipeline script from SCM**, arahkan ke
   repository Git proyek ini, pilih branch yang mau dirilis (mis. `main`), dan
   set **Script Path** ke `Jenkinsfile`. Aktifkan webhook GitHub bila ingin
   deploy otomatis setiap ada push.
2. Pastikan Jenkins punya NodeJS tool bernama `NodeJS 22`, Docker Engine dengan
   Buildx dan dukungan build `linux/amd64` serta `linux/arm64`.
3. Gunakan SSH private-key credential `biznet-vps` yang sama dengan deploy
   BarberSip. Pastikan fingerprint VPS sudah ada di `known_hosts` akun Jenkins;
   pipeline mensyaratkan `StrictHostKeyChecking=yes`.
4. Gunakan username/password credential `ghcr-write` (GitHub username dan token
   dengan izin `write:packages`).
5. Buat Jenkins **Secret file** credential dengan ID
   `devlabhub-telegram-bot-env`. Isinya file environment runtime, minimal:

   ```env
   API_KEY=secret-acak-minimal-16-karakter
   TELEGRAM_BOT_TOKEN=token-bot-dari-botfather
   ```

   Jangan commit atau tempelkan secret ke Jenkinsfile/log. Gunakan token bot
   yang sudah dirotasi lewat BotFather.
6. Pipeline memakai VPS `100.87.90.67`, user `devlabhub`, direktori khusus
   `/home/devlabhub/devlabhub-telegram-bot`, dan GHCR namespace default
   `syarifudinyoga`. Ubah nilai-nilai tersebut di Jenkinsfile jika deployment
   environment-mu berbeda.
7. Pastikan user VPS dapat menjalankan `podman`, `curl`, dan
   `~/.local/bin/podman-compose`. GHCR package perlu dapat dipull oleh VPS;
   jika private, pipeline login memakai credential `ghcr-write`.

Port host `127.0.0.1:3006` hanya terbuka lokal pada VPS, cocok untuk reverse
proxy yang berjalan di mesin yang sama. Untuk endpoint publik, konfigurasikan
reverse proxy HTTPS ke port tersebut; jangan expose port tanpa TLS.
