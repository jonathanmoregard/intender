package com.app

import android.content.Intent
import android.net.VpnService
import android.os.ParcelFileDescriptor
import android.util.Log
import java.io.IOException

class IntenderVpnService : VpnService() {

    private var vpnInterface: ParcelFileDescriptor? = null
    private val TAG = "IntenderVpnService"

    companion object {
        const val ACTION_START = "com.app.vpn.START"
        const val ACTION_STOP = "com.app.vpn.STOP"
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent != null) {
            when (intent.action) {
                ACTION_START -> startVpn()
                ACTION_STOP -> stopVpn()
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        stopVpn()
    }

    private fun startVpn() {
        if (vpnInterface != null) return

        Log.i(TAG, "Starting VPN...")

        try {
            val builder = Builder()
            
            // Set MTU
            builder.setMtu(1500)
            
            // Add address - arbitrary private usage 
            builder.addAddress("10.0.0.2", 32)
            
            // Add route - for now, route everything to verify interception
            // In real app, we might only route DNS (8.8.8.8) or specific IPs
            builder.addRoute("0.0.0.0", 0)
            
            // Construct the interface
            // Create a pending intent for config (required by some Android versions/Binders)
            val configIntent = android.app.PendingIntent.getActivity(
                this,
                0,
                Intent(this, MainActivity::class.java),
                android.app.PendingIntent.FLAG_IMMUTABLE
            )

            vpnInterface = builder.setSession("IntenderVPN")
                .setConfigureIntent(configIntent)
                .establish()

            Log.i(TAG, "VPN Established")

        } catch (e: Exception) {
            Log.e(TAG, "Failed to establish VPN", e)
        }
    }

    private fun stopVpn() {
        try {
            vpnInterface?.close()
            vpnInterface = null
            Log.i(TAG, "VPN Stopped")
        } catch (e: IOException) {
            Log.e(TAG, "Error stopping VPN", e)
        }
        stopSelf()
    }
}
