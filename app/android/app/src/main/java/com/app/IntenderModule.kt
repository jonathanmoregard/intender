package com.app

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.BaseJavaModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class IntenderModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    private val VPN_REQUEST_CODE = 0x0F

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName(): String {
        return "IntenderModule"
    }

    @ReactMethod
    fun startVpn(promise: Promise) {
        val activity = getCurrentActivity()
        if (activity == null) {
            promise.reject("E_ACTIVITY_NULL", "Activity is null")
            return
        }

        val prepareIntent = VpnService.prepare(activity)
        if (prepareIntent != null) {
            // Need to request permission
            try {
                activity.startActivityForResult(prepareIntent, VPN_REQUEST_CODE)
                // We could store the promise to resolve later, but for simplicity:
                promise.resolve("Permission requested")
            } catch (e: Exception) {
                promise.reject("E_START_VPN", e)
            }
        } else {
            // Already permitted
            startService()
            promise.resolve("Started")
        }
    }

    @ReactMethod
    fun stopVpn(promise: Promise) {
        val intent = Intent(reactApplicationContext, IntenderVpnService::class.java)
        intent.action = IntenderVpnService.ACTION_STOP
        reactApplicationContext.startService(intent)
        promise.resolve("Stopped")
    }

    private fun startService() {
        val intent = Intent(reactApplicationContext, IntenderVpnService::class.java)
        intent.action = IntenderVpnService.ACTION_START
        reactApplicationContext.startService(intent)
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == VPN_REQUEST_CODE) {
            if (resultCode == Activity.RESULT_OK) {
                startService()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {}
}
