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

Server berjalan di port `3006` secara default; ubah dengan `PORT` di `.env`.
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
