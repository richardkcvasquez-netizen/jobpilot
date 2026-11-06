package com.jobpilot.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File

/**
 * Opens a job posting, injects the autofill engine (assets/www/autofill.js) and fills the
 * application with the user's profile. The user reviews and submits; nothing is sent
 * without them seeing it unless they turned on Auto-submit in Settings.
 */
class ApplyActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var status: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var jobId: String
    private var payload = "{}"
    private var autofillJs = ""
    private var bestReport: JSONObject? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        jobId = intent.getStringExtra(EXTRA_JOB_ID) ?: return finish()
        val url = intent.getStringExtra(EXTRA_URL) ?: return finish()
        payload = pendingPayload ?: "{}"
        autofillJs = assets.open("www/autofill.js").bufferedReader().use { it.readText() }

        val accent = Color.parseColor("#3B5BFD")
        fun btn(label: String, primary: Boolean = false, onClick: () -> Unit) = Button(this).apply {
            text = label
            isAllCaps = false
            setTextColor(if (primary) Color.WHITE else accent)
            setBackgroundColor(if (primary) accent else Color.parseColor("#EEF1FF"))
            setPadding(28, 0, 28, 0)
            minWidth = 0; minimumWidth = 0
            setOnClickListener { onClick() }
        }

        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(16, 12, 16, 12)
            setBackgroundColor(Color.WHITE)
            addView(btn("✕") { done("closed") })
            addView(TextView(context).apply {
                text = Uri.parse(url).host?.removePrefix("www.") ?: "Apply"
                setPadding(16, 0, 8, 0)
                maxLines = 1
                setTextColor(Color.DKGRAY)
            }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
            addView(btn("Skip") { done("skipped") })
            addView(space())
            addView(btn("Autofill") { runAutofill() })
            addView(space())
            addView(btn("Applied ✓", primary = true) { done("applied") })
        }
        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100 }
        status = TextView(this).apply {
            setPadding(24, 14, 24, 14)
            setBackgroundColor(Color.parseColor("#F6F7FB"))
            setTextColor(Color.DKGRAY)
            text = "Loading…"
        }

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.loadWithOverviewMode = true
            settings.useWideViewPort = true
            settings.setSupportMultipleWindows(false)
            // Some ATS login flows reject the WebView marker in the user agent.
            settings.userAgentString = settings.userAgentString.replace("; wv", "")
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, u: String) {
                    // Give single-page apps (Workday, Ashby) a moment to render the form.
                    view.postDelayed({ runAutofill() }, 1200)
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onProgressChanged(view: WebView, p: Int) {
                    progressBar.progress = p
                    progressBar.visibility = if (p < 100) View.VISIBLE else View.GONE
                }

                override fun onShowFileChooser(
                    view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams
                ): Boolean {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = cb
                    offerResume(params)
                    return true
                }
            }
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            fitsSystemWindows = true
            addView(bar, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            addView(progressBar, LinearLayout.LayoutParams(MATCH_PARENT, 8))
            addView(web, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
            addView(status, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        })
        web.loadUrl(url)
    }

    private fun space() = View(this).apply { layoutParams = LinearLayout.LayoutParams(12, 1) }

    private var fillGeneration = 0

    /** Starts the (asynchronous) autofill in the page, then polls for its report. */
    private fun runAutofill() {
        val gen = ++fillGeneration
        status.text = "Filling in your details…"
        web.evaluateJavascript("$autofillJs\n;window.__jobpilot.start($payload);0", null)
        pollReport(gen, 0)
    }

    private fun pollReport(gen: Int, attempt: Int) {
        if (gen != fillGeneration || isFinishing) return
        web.evaluateJavascript("window.__jobpilot ? JSON.stringify(window.__jobpilot.status()) : null") { raw ->
            val report = try { JSONObject(JSONObject("{\"v\":$raw}").getString("v")) } catch (e: Exception) { null }
            if (report == null) {
                // Still running (dropdowns take a moment each). Give up after ~45 seconds.
                if (attempt < 90) web.postDelayed({ pollReport(gen, attempt + 1) }, 500)
                else status.text = "Autofill is taking too long on this page. Tap Autofill to try again."
                return@evaluateJavascript
            }
            showReport(report)
        }
    }

    private fun showReport(report: JSONObject) {
        run {
            val redirect = report.optString("redirect")
            if (redirect.isNotEmpty() && redirect != "null") {
                status.text = "Opening the embedded application form…"
                web.loadUrl(redirect)
                return@run
            }
            val prev = bestReport
            if (prev == null || report.optString("description").length >= prev.optString("description").length ||
                report.optInt("total") > prev.optInt("total")
            ) bestReport = report

            val filled = report.optInt("filled"); val total = report.optInt("total")
            val open = report.optJSONArray("unanswered")?.length() ?: 0
            status.setTypeface(null, Typeface.NORMAL)
            status.text = when {
                report.optBoolean("autoSubmitted") -> "Auto-submitted. Check the page for a confirmation, then tap Applied ✓."
                total == 0 && report.optBoolean("applyButton") -> "Opened the application form. Autofilling…"
                total == 0 -> "No form on this page yet. Open the application, then tap Autofill."
                else -> buildString {
                    append("Filled $filled of $total fields")
                    if (report.optBoolean("resumeAttached")) append(" · resume attached")
                    if (open > 0) append(" · $open question(s) need your answer")
                    append(". Fields in red need you. Review, submit, then tap Applied ✓.")
                }
            }
            if (total == 0 && report.optBoolean("applyButton")) web.postDelayed({ runAutofill() }, 1500)
        }
    }

    private fun offerResume(params: WebChromeClient.FileChooserParams) {
        val resume = File(filesDir, "resume").listFiles()?.firstOrNull()
        if (resume == null) return openSystemPicker(params)
        AlertDialog.Builder(this)
            .setTitle("Attach a file")
            .setItems(arrayOf("Use my resume (${resume.name})", "Choose another file…")) { _, which ->
                if (which == 0) {
                    val uri = FileProvider.getUriForFile(this, "$packageName.files", resume)
                    fileCallback?.onReceiveValue(arrayOf(uri)); fileCallback = null
                } else openSystemPicker(params)
            }
            .setOnCancelListener { fileCallback?.onReceiveValue(null); fileCallback = null }
            .show()
    }

    private fun openSystemPicker(params: WebChromeClient.FileChooserParams) {
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(params.createIntent(), REQ_FILE)
        } catch (e: Exception) {
            fileCallback?.onReceiveValue(null); fileCallback = null
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_FILE) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
        }
    }

    private fun done(outcome: String) {
        setResult(RESULT_OK, Intent()
            .putExtra(EXTRA_JOB_ID, jobId)
            .putExtra(EXTRA_OUTCOME, outcome)
            .putExtra(EXTRA_REPORT, bestReport?.let { r ->
                // Keep the result small: the description is all the main UI needs besides counts.
                JSONObject().put("filled", r.optInt("filled")).put("total", r.optInt("total"))
                    .put("title", r.optString("title")).put("description", r.optString("description").take(12000))
                    .put("unanswered", r.optJSONArray("unanswered")).toString()
            } ?: "null"))
        finish()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else done("closed")
    }

    companion object {
        const val EXTRA_JOB_ID = "jobId"
        const val EXTRA_URL = "url"
        const val EXTRA_REPORT = "report"
        const val EXTRA_OUTCOME = "outcome"
        private const val REQ_FILE = 7

        /** Profile payload handed over from MainActivity (too large for Intent extras with a resume). */
        @Volatile var pendingPayload: String? = null
    }
}
