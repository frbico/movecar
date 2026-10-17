package com.example.movecarvoice

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Reusable native UI primitives. No WebView; the existing WebRTC / FCM logic
 * stays in its foreground service. Material-inspired surfaces and 48dp targets.
 */
internal object OwnerUi {
    val navy = Color.rgb(20, 41, 78)
    val blue = Color.rgb(38, 100, 224)
    val blueDeep = Color.rgb(16, 57, 153)
    val canvas = Color.rgb(246, 248, 252)
    val muted = Color.rgb(108, 122, 147)
    val line = Color.rgb(231, 236, 246)
    val white = Color.WHITE
    val softBlue = Color.rgb(234, 241, 255)
    val green = Color.rgb(23, 128, 92)
    val softGreen = Color.rgb(229, 247, 238)
    val amber = Color.rgb(164, 99, 23)
    val softAmber = Color.rgb(255, 244, 226)
    val red = Color.rgb(187, 62, 74)
    val softRed = Color.rgb(255, 235, 238)

    fun dp(context: Context, value: Int): Int =
        (context.resources.displayMetrics.density * value + 0.5f).toInt()

    fun bg(color: Int, radiusDp: Int, ctx: Context, stroke: Int? = null): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(ctx, radiusDp).toFloat()
            if (stroke != null) setStroke(dp(ctx, 1), stroke)
        }

    fun gradient(context: Context): GradientDrawable =
        GradientDrawable(GradientDrawable.Orientation.TL_BR,
            intArrayOf(blue, blueDeep)).apply { cornerRadius = dp(context, 24).toFloat() }

    fun pressable(context: Context, color: Int, radius: Int = 14, border: Int? = null): RippleDrawable =
        RippleDrawable(
            ColorStateList.valueOf(Color.argb(36, 20, 60, 120)),
            bg(color, radius, context, border),
            null
        )

    fun label(ctx: Context, text: String, size: Float = 14f, color: Int = navy,
              weight: Boolean = false): TextView =
        TextView(ctx).apply {
            this.text = text
            textSize = size
            setTextColor(color)
            includeFontPadding = true
            if (weight) typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        }

    fun pill(ctx: Context, text: String, good: Boolean? = null): TextView {
        val colors = when (good) {
            true -> softGreen to green
            false -> softAmber to amber
            else -> softBlue to blue
        }
        return label(ctx, text, 12f, colors.second, true).apply {
            gravity = Gravity.CENTER
            background = bg(colors.first, 50, ctx)
            setPadding(dp(ctx, 12), dp(ctx, 7), dp(ctx, 12), dp(ctx, 7))
        }
    }

    fun vertical(ctx: Context): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
    }

    fun horizontal(ctx: Context): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
    }

    fun card(ctx: Context): LinearLayout = vertical(ctx).apply {
        background = bg(white, 20, ctx, line)
        setPadding(dp(ctx, 16), dp(ctx, 16), dp(ctx, 16), dp(ctx, 16))
        elevation = dp(ctx, 2).toFloat()
    }

    fun icon(ctx: Context, res: Int, tint: Int = blue, sizeDp: Int = 22): ImageView =
        ImageView(ctx).apply {
            setImageResource(res)
            setColorFilter(tint)
            layoutParams = LinearLayout.LayoutParams(dp(ctx, sizeDp), dp(ctx, sizeDp))
            contentDescription = null
        }

    fun line(ctx: Context): View = View(ctx).apply {
        setBackgroundColor(line)
        layoutParams = LinearLayout.LayoutParams(-1, dp(ctx, 1))
    }

    fun centerEmpty(ctx: Context, heading: String, description: String): LinearLayout =
        vertical(ctx).apply {
            setPadding(dp(ctx, 22), dp(ctx, 34), dp(ctx, 22), dp(ctx, 34))
            gravity = Gravity.CENTER
            addView(icon(ctx, android.R.drawable.ic_menu_info_details, muted, 38))
            addView(label(ctx, heading, 17f, navy, true).apply {
                gravity = Gravity.CENTER
                setPadding(0, dp(ctx, 16), 0, dp(ctx, 5))
            })
            addView(label(ctx, description, 13f, muted).apply { gravity = Gravity.CENTER })
        }
}
