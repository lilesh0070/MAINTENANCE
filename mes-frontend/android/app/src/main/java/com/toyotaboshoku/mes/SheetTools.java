package com.toyotaboshoku.mes;

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * SHEET KA PRINT AUR EXCEL FILE — APP KE ANDAR.
 *
 * KYUN BANANA PADA
 * ----------------
 * Website par ye dono kaam browser khud kar deta hai.  APK ke andar DONO
 * CHUP-CHAAP MARR JAATE HAIN, aur — sabse buri baat — koi error bhi nahi
 * aata.  Button dabta hai, kuch nahi hota:
 *
 *   1. `window.print()` — Android WebView ise laagu hi nahi karta.  Print
 *      ka parda browser ka hissa hai, rendering engine ka nahi.  Android me
 *      chhapne ka ek hi raasta hai: `PrintManager` ko WebView ka
 *      `PrintDocumentAdapter` do.  Wahi neeche `chhapo()` karta hai.
 *
 *   2. Blob wala download — WebView bina `DownloadListener` ke use nigal
 *      jaata hai.  Aur `DownloadListener` bhi `blob:` URL nahi utha sakta
 *      (wo sirf browser ki apni yaad me hai, kisi server par nahi).  Isliye
 *      file ke BYTES seedhe JS se yahan bheje jaate hain — `faylSejo()`.
 *
 * DO JAGAH DHYAN RAKHA HAI
 * ------------------------
 * • Print wali WebView ka STRONG REFERENCE pakad kar rakha hai (`chhapneWali`).
 *   Bina iske Java use kachra samajh kar utha leta hai print poora hone se
 *   PEHLE, aur print job beech me hi mar jaata hai — Android ka ye purana
 *   jaal hai, aur ye galti bhi chup-chaap hoti hai.
 *
 * • File Android 10+ par MediaStore se ASLI Downloads folder me jaati hai
 *   (koi permission nahi lagti).  Android 9 aur usse purane par MediaStore
 *   ka ye raasta hai hi nahi aur public Downloads me likhne ke liye
 *   WRITE_EXTERNAL_STORAGE maangni padti — isliye wahan app ke apne
 *   external folder me daalte hain.  Dono soorat me file ka pata wapas
 *   bheja jaata hai taaki user ko dikha sakein ki gayi kahan.
 */
@CapacitorPlugin(name = "SheetTools")
public class SheetTools extends Plugin {

    /** Print khatam hone tak WebView ko zinda rakhne ke liye — upar dekhein. */
    private static WebView chhapneWali = null;

    /* ────────────────────────────────────────────────────────────────
       PRINT
       ──────────────────────────────────────────────────────────────── */

    /**
     * Poora HTML lo aur Android ka print parda khol do.
     *
     * JS `<base href="…">` ke saath bhejta hai aur tasveerein pehle hi
     * `data:` me badal deta hai, isliye yahan alag se koi file server nahi
     * chahiye — ye WebView Capacitor wale local server se juda nahi hota,
     * to `/logo.jpg` yahan waise bhi na khulta.
     */
    @PluginMethod
    public void chhapo(final PluginCall call) {
        final String html = call.getString("html", "");
        final String naam = call.getString("naam", "Sheet");

        if (html.isEmpty()) { call.reject("Nothing to print"); return; }

        // PrintManager sirf UI thread par chalega; Capacitor plugin ke
        // method background thread par aate hain, isliye hop zaroori hai.
        getActivity().runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    final PrintManager pm =
                        (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
                    if (pm == null) {
                        // Kai TV box par print ki seva hoti hi nahi.  Saaf
                        // bata do — JS ise user ko dikha dega.
                        call.reject("Printing is not available on this device");
                        return;
                    }

                    final WebView wv = new WebView(getContext());
                    wv.getSettings().setJavaScriptEnabled(false);   // sirf chhapna hai
                    wv.setWebViewClient(new WebViewClient() {
                        @Override public void onPageFinished(WebView view, String url) {
                            try {
                                PrintDocumentAdapter ad = view.createPrintDocumentAdapter(naam);
                                PrintAttributes at = new PrintAttributes.Builder()
                                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                    .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                                    .build();
                                pm.print(naam, ad, at);
                                call.resolve();
                            } catch (Throwable t) {
                                call.reject("Could not start printing: " + t.getMessage());
                            } finally {
                                // Reference ab chhoda ja sakta hai — print
                                // job PrintManager ke paas ja chuka hai.
                                chhapneWali = null;
                            }
                        }
                    });

                    chhapneWali = wv;      // GC se bachao (upar wali tippani)
                    wv.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                } catch (Throwable t) {
                    chhapneWali = null;
                    call.reject("Could not print: " + t.getMessage());
                }
            }
        });
    }

    /* ────────────────────────────────────────────────────────────────
       FILE SAVE
       ──────────────────────────────────────────────────────────────── */

    /** base64 bytes lo, Downloads me file banao, aur "kholein?" ka chooser dikha do. */
    @PluginMethod
    public void faylSejo(PluginCall call) {
        final String b64  = call.getString("base64", "");
        final String naam = call.getString("naam", "file.xlsx");
        final String mime = call.getString("mime", "application/octet-stream");

        if (b64.isEmpty()) { call.reject("The file is empty"); return; }

        try {
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            String kahan = downloadsMeDaalo(bytes, naam, mime);
            JSObject r = new JSObject();
            r.put("kahan", kahan);
            call.resolve(r);
        } catch (Throwable t) {
            call.reject("Could not save the file: " + t.getMessage());
        }
    }

    /**
     * Bytes ko Downloads me daal do aur "kis app se kholein" ka chooser
     * dikha do.  File ka pata wapas deta hai.
     *
     * Do raaste, kyunki Android 10 par sab badal gaya tha:
     *   • API 29+ : MediaStore -> ASLI Downloads folder, bina permission.
     *   • usse purane : MediaStore ka ye raasta hai hi nahi, aur public
     *     Downloads me likhne ko WRITE_EXTERNAL_STORAGE maangni padti —
     *     isliye app ke apne external folder me daalte hain.
     */
    private String downloadsMeDaalo(byte[] bytes, String naam, String mime) throws Exception {
        Uri uri;
        String kahan;
        {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10+: asli Downloads folder, bina kisi permission ke.
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.MediaColumns.DISPLAY_NAME, naam);
                cv.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                uri = getContext().getContentResolver()
                        .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) throw new Exception("Could not create the file in Downloads");
                OutputStream os = getContext().getContentResolver().openOutputStream(uri);
                if (os == null) throw new Exception("Could not write the file");
                os.write(bytes); os.flush(); os.close();
                kahan = "Downloads";
            } else {
                // Android 9 aur purane: MediaStore ka ye raasta hai hi nahi,
                // aur public Downloads ke liye permission maangni padti.  App
                // ka apna external folder bina permission ke chalta hai.
                File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null) throw new Exception("Storage is not available");
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, naam);
                FileOutputStream fos = new FileOutputStream(f);
                fos.write(bytes); fos.flush(); fos.close();
                uri = FileProvider.getUriForFile(
                        getContext(), getContext().getPackageName() + ".fileprovider", f);
                kahan = f.getAbsolutePath();
            }

        }

        // "Kis app se kholein?" — file ban gayi hai ye user ko dikh jaaye.
        // Na khule to bhi file to bach hi gayi hai, isliye ye try ke andar.
        try {
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, mime);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            Intent ch = Intent.createChooser(i, naam);
            ch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(ch);
        } catch (Throwable ignore) { }

        return kahan;
    }

    /* ────────────────────────────────────────────────────────────────
       PDF -- yahan `pdfBanao()` tha, HATA DIYA GAYA (2026-09-08)
       ────────────────────────────────────────────────────────────────
       `PdfDocument` par WebView ko `draw()` karke PDF banayi thi.  Emulator
       par baar-baar naap kar dekha to wo bharosemand nahi nikli -- ek hi
       content par kabhi poora panna aata, kabhi BILKUL KHALI.  Jo cheezein
       pakdi gayin (har ek chup-chaap hoti thi):
         • bina-attach View par `postDelayed` ka runnable kabhi chalta hi nahi
         • pehli `draw()` par Chromium ne abhi paint kiya hi nahi hota
         • hardware-accelerated WebView software bitmap par kuch nahi likhti
         • PdfDocument ke canvas par WebView `translate` nazarandaaz kar deta
           hai -- saare panne byte-to-byte ek jaise aa jaate hain
         • badi naap par software layer chup-chaap khali de deta hai
       Har ek ka hal nikla, par natija phir bhi naap-dar-naap badalta raha,
       aur wo Android ke version/device par nirbhar hai.  Plant me "PDF ban
       gayi" kehkar khali kaagaz dena, kuch na dene se bura hai.

       Ab PDF `chhapo()` se banti hai -- Android ka apna print parda, jisme
       "Save as PDF" hota hai.  Wo Android ke apne (aazmaye hue) code se
       banti hai aur usme text vector rehta hai.  Ek tap zyada lagta hai,
       par file sahi milti hai.

       Agar kabhi ek-tap PDF chahiye ho: sahi raasta
       `PrintDocumentAdapter` ko khud chalana hai (wahi jo PrintManager
       chalata hai) -- par uske callback ke constructor package-private hain,
       to class ko `package android.print;` me daalna padta hai.  Wo system
       package me ghusna hai; is app me wo jokhim nahi liya gaya. */
}
