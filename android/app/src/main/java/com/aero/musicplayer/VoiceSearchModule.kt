package com.aero.musicplayer

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.Locale

class VoiceSearchModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    private var speechPromise: Promise? = null
    private val SPEECH_REQUEST_CODE = 4210

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName(): String = "VoiceSearchModule"

    @ReactMethod
    fun startSpeechRecognition(promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.reject("E_ACTIVITY_DOES_NOT_EXIST", "Activity does not exist")
            return
        }

        if (speechPromise != null) {
            speechPromise?.reject("E_SPEECH_CANCELLED", "New speech request started")
            speechPromise = null
        }

        speechPromise = promise

        try {
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
                )
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak to search music...")
            }
            activity.startActivityForResult(intent, SPEECH_REQUEST_CODE)
        } catch (e: Exception) {
            speechPromise?.reject("E_FAILED_TO_START", e.message)
            speechPromise = null
        }
    }

    override fun onActivityResult(
        activity: Activity,
        requestCode: Int,
        resultCode: Int,
        data: Intent?
    ) {
        if (requestCode == SPEECH_REQUEST_CODE) {
            if (resultCode == Activity.RESULT_OK && data != null) {
                val results = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                if (results != null && results.isNotEmpty()) {
                    speechPromise?.resolve(results[0])
                } else {
                    speechPromise?.reject("E_NO_RESULTS", "No speech recognized")
                }
            } else {
                speechPromise?.reject("E_CANCELLED", "Speech recognition was cancelled")
            }
            speechPromise = null
        }
    }

    override fun onNewIntent(intent: Intent) {
        // No-op
    }
}
