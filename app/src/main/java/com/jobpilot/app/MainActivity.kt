package com.jobpilot.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.File

/**
 * Hosts the JobPilot UI (assets/www) in a WebView. The UI is served from a virtual
 * https origin so localStorage, fetch() and the Anthropic SDK behave like a normal site.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private var pendingShare: String? = null
    private var uiReady = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    loader.shouldInterceptRequest(request.url)
            }
            addJavascriptInterface(Bridge(), "Android")
        }
        setContentView(web)
        web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
        handleShare(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShare(intent)
    }

    private fun handleShare(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val text = listOfNotNull(
            intent.getStringExtra(Intent.EXTRA_TEXT),
            intent.getStringExtra(Intent.EXTRA_SUBJECT)
        ).joinToString(" ")
        if (uiReady) deliverShare(text) else pendingShare = text
    }

    private fun deliverShare(text: String) {
        web.evaluateJavascript("App.addJobFromShare(${JSONObject.quote(text)})", null)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_APPLY || data == null) return
        val id = data.getStringExtra(ApplyActivity.EXTRA_JOB_ID) ?: return
        val report = data.getStringExtra(ApplyActivity.EXTRA_REPORT) ?: "null"
        val outcome = data.getStringExtra(ApplyActivity.EXTRA_OUTCOME) ?: "closed"
        web.evaluateJavascript(
            "App.onApplyResult(${JSONObject.quote(id)}, $report, ${JSONObject.quote(outcome)})", null
        )
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        web.evaluateJavascript("(function(){var s=document.querySelector('.sheet-bg');if(s){s.remove();return true}return false})()") {
            if (it != "true") @Suppress("DEPRECATION") super.onBackPressed()
        }
    }

    /** Methods callable from JavaScript as window.Android.* (run on a background thread). */
    inner class Bridge {
        @JavascriptInterface
        fun ready() = runOnUiThread {
            uiReady = true
            pendingShare?.let { deliverShare(it); pendingShare = null }
        }

        @JavascriptInterface
        fun syncState(json: String) {
            // Keep a copy of the resume as a real file so ApplyActivity can hand it to file pickers.
            val resume = JSONObject(json).optJSONObject("resume") ?: return
            val name = resume.optString("name", "resume.pdf").replace(Regex("[^A-Za-z0-9._ -]"), "_")
            val dir = File(filesDir, "resume").apply { mkdirs() }
            dir.listFiles()?.filter { it.name != name }?.forEach { it.delete() }
            val f = File(dir, name)
            val bytes = Base64.decode(resume.optString("data"), Base64.DEFAULT)
            if (!f.exists() || f.length() != bytes.size.toLong()) f.writeBytes(bytes)
        }

        @JavascriptInterface
        fun apply(jobId: String, url: String, payloadJson: String) = runOnUiThread {
            syncState(payloadJson)
            ApplyActivity.pendingPayload = payloadJson
            @Suppress("DEPRECATION")
            startActivityForResult(
                Intent(this@MainActivity, ApplyActivity::class.java)
                    .putExtra(ApplyActivity.EXTRA_JOB_ID, jobId)
                    .putExtra(ApplyActivity.EXTRA_URL, url),
                REQ_APPLY
            )
        }

        @JavascriptInterface
        fun saveFile(name: String, content: String) = runOnUiThread {
            val dir = File(cacheDir, "exports").apply { mkdirs() }
            val f = File(dir, name).apply { writeText(content) }
            val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.files", f)
            startActivity(
                Intent.createChooser(
                    Intent(Intent.ACTION_SEND).setType("application/json")
                        .putExtra(Intent.EXTRA_STREAM, uri)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
                    "Save JobPilot backup"
                )
            )
        }
    }

    companion object {
        private const val REQ_APPLY = 41
    }
}
