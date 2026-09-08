package com.toyotaboshoku.mes;

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.graphics.Canvas;
import android.graphics.pdf.PdfDocument;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
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

        if (html.isEmpty()) { call.reject("HTML khali hai"); return; }

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
                        call.reject("Is device par print ki suvidha nahi hai");
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
                                call.reject("Print shuru nahi ho paya: " + t.getMessage());
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
                    call.reject("Print nahi ho paya: " + t.getMessage());
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

        if (b64.isEmpty()) { call.reject("File khali hai"); return; }

        try {
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            String kahan = downloadsMeDaalo(bytes, naam, mime);
            JSObject r = new JSObject();
            r.put("kahan", kahan);
            call.resolve(r);
        } catch (Throwable t) {
            call.reject("File save nahi hui: " + t.getMessage());
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
                if (uri == null) throw new Exception("Downloads me jagah nahi mili");
                OutputStream os = getContext().getContentResolver().openOutputStream(uri);
                if (os == null) throw new Exception("File likhi nahi ja saki");
                os.write(bytes); os.flush(); os.close();
                kahan = "Downloads";
            } else {
                // Android 9 aur purane: MediaStore ka ye raasta hai hi nahi,
                // aur public Downloads ke liye permission maangni padti.  App
                // ka apna external folder bina permission ke chalta hai.
                File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null) throw new Exception("Storage nahi mila");
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
       PDF — ek tap me asli file, print ka parda khole bina
       ──────────────────────────────────────────────────────────────── */

    /** PDF banane wali WebView — print jaisa hi GC se bachana zaroori hai. */
    private static WebView pdfWali = null;

    /**
     * HTML se seedhe ek PDF file banao aur Downloads me daal do.
     *
     * `chhapo()` SE ALAG KYUN
     * -----------------------
     * `chhapo()` Android ka print parda kholta hai — wahan user ko printer
     * (ya "Save as PDF") chunna padta hai.  Yahan kuch nahi chunna: file
     * seedha ban kar Downloads me girti hai, jaise website par "Download"
     * dabane se girti hai.
     *
     * KAISE — aur JO TAREEQA JAAN-BOOJH KAR NAHI CHUNA
     * ------------------------------------------------
     * Aam tareeqa `WebView.createPrintDocumentAdapter()` ko KHUD chalane ka
     * hai.  Wo yahan chal NAHI sakta: uske callback
     * (`PrintDocumentAdapter.LayoutResultCallback` / `WriteResultCallback`)
     * ke constructor package-private hain, to unhe `android.print` package
     * ke BAHAR se subclass nahi kiya ja sakta.  Internet par iska hal "apni
     * class ko `package android.print;` me daal do" milta hai — wo system
     * package me ghusna hai, aur plant ki app me wo jokhim nahi lena.
     *
     * Isliye yahan poori tarah PUBLIC API istemal ki hai:
     * `PdfDocument` par WebView ko seedha `draw()` kar dete hain.  Text
     * bitmap nahi banta (canvas par vector jaata hai), isliye PDF me akshar
     * saaf rehte hain aur file bhi bhaari nahi hoti.
     *
     * Lamba content apne aap kai panno me bat jaata hai: har panne par
     * canvas ko utna upar khiska dete hain jitna pichhle panne ne dikhaya.
     */
    @PluginMethod
    public void pdfBanao(final PluginCall call) {
        final String html  = call.getString("html", "");
        final String naam  = call.getString("naam", "sheet") + ".pdf";
        final boolean khada = Boolean.TRUE.equals(call.getBoolean("khada", false));
        if (html.isEmpty()) { call.reject("HTML khali hai"); return; }

        getActivity().runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    // Kaagaz — PDF points me naapta hai (1 point = 1/72 inch).
                    // A4 = 595 x 842 pt.
                    final int pw = khada ? 595 : 842;
                    final int ph = khada ? 842 : 595;
                    // Content ko kaagaz se DO GUNA chaudai par banate hain aur
                    // phir aadha kar dete hain -- isse layout usi hisaab se
                    // banta hai jo kaagaz par chahiye, par naap-jokh (font,
                    // border) do guna barik hoti hai.
                    final int cw = pw * 2;

                    final WebView wv = new WebView(getContext());
                    wv.getSettings().setJavaScriptEnabled(false);
                    wv.setWebViewClient(new WebViewClient() {
                        @Override public void onPageFinished(WebView view, String url) {
                            // Ek frame ruk kar naapte hain -- turant naapne par
                            // height aksar 0 aati hai (layout abhi bana hi nahi).
                            view.postDelayed(new Runnable() {
                                @Override public void run() {
                                    try {
                                        banao(view, naam, pw, ph, cw, call);
                                    } catch (Throwable t) {
                                        pdfWali = null;
                                        call.reject("PDF nahi ban payi: " + t.getMessage());
                                    }
                                }
                            }, 350);
                        }
                    });
                    // Screen se bahar, par naap-jokh ke liye poora chauda.
                    wv.measure(View.MeasureSpec.makeMeasureSpec(cw, View.MeasureSpec.EXACTLY),
                               View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
                    wv.layout(0, 0, cw, 10);
                    pdfWali = wv;                       // GC se bachao
                    wv.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                } catch (Throwable t) {
                    pdfWali = null;
                    call.reject("PDF nahi ban payi: " + t.getMessage());
                }
            }
        });
    }

    /** Naapi hui WebView ko panno me baant kar PDF likho. */
    private void banao(WebView view, String naam, int pw, int ph, int cw, PluginCall call)
            throws Exception {
        // Poori lambai naapo (scroll wali nahi -- content ki asli height).
        view.measure(View.MeasureSpec.makeMeasureSpec(cw, View.MeasureSpec.EXACTLY),
                     View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
        int ch = Math.max(view.getMeasuredHeight(), view.getContentHeight());
        if (ch <= 0) ch = cw;                          // kuch naapa hi na gaya -> ek panna
        view.layout(0, 0, cw, ch);

        final float s = (float) pw / (float) cw;        // kaagaz me bithane ka paimana
        final int panneKiContentHeight = Math.max(1, (int) (ph / s));
        final int panne = Math.max(1, (int) Math.ceil((double) ch / panneKiContentHeight));

        PdfDocument doc = new PdfDocument();
        try {
            for (int i = 0; i < panne; i++) {
                PdfDocument.PageInfo pi =
                        new PdfDocument.PageInfo.Builder(pw, ph, i + 1).create();
                PdfDocument.Page page = doc.startPage(pi);
                Canvas c = page.getCanvas();
                c.save();
                c.scale(s, s);
                c.translate(0, -(float) (i * panneKiContentHeight));
                view.draw(c);
                c.restore();
                doc.finishPage(page);
            }
            File tmp = new File(getContext().getCacheDir(), "tb_" + System.currentTimeMillis() + ".pdf");
            FileOutputStream out = new FileOutputStream(tmp);
            doc.writeTo(out);
            out.close();
            byte[] bytes = padho(tmp);
            tmp.delete();
            pdfWali = null;

            String kahan = downloadsMeDaalo(bytes, naam, "application/pdf");
            JSObject r = new JSObject();
            r.put("kahan", kahan);
            r.put("panne", panne);
            call.resolve(r);
        } finally {
            doc.close();
        }
    }

    /** Chhoti file ko poora memory me padh lo (PDF yahin se Downloads jaati hai). */
    private static byte[] padho(File f) throws Exception {
        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
        java.io.FileInputStream in = new java.io.FileInputStream(f);
        byte[] buf = new byte[8192];
        int k;
        while ((k = in.read(buf)) > 0) bos.write(buf, 0, k);
        in.close();
        return bos.toByteArray();
    }

}
