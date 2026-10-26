package com.example.movecarvoice

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.min

/** Shared native surfaces for the owner console and call screens. */
internal object OwnerUi {
    val navy = Color.rgb(31, 52, 49)
    val blue = Color.rgb(39, 115, 124)
    val blueDeep = Color.rgb(33, 91, 87)
    val canvas = Color.rgb(247, 249, 245)
    val muted = Color.rgb(111, 131, 127)
    val line = Color.rgb(229, 237, 232)
    val white = Color.WHITE

    val softBlue = Color.rgb(213, 241, 247)
    val cyan = Color.rgb(175, 228, 237)
    val green = Color.rgb(56, 136, 105)
    val softGreen = Color.rgb(224, 243, 210)
    val lime = Color.rgb(189, 231, 152)
    val amber = Color.rgb(155, 107, 42)
    val softAmber = Color.rgb(255, 242, 211)
    val red = Color.rgb(178, 76, 80)
    val softRed = Color.rgb(252, 231, 229)

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
            intArrayOf(softGreen, cyan)).apply { cornerRadius = dp(context, 30).toFloat() }

    fun pressable(context: Context, color: Int, radius: Int = 18, border: Int? = null): RippleDrawable =
        RippleDrawable(
            ColorStateList.valueOf(Color.argb(32, 44, 129, 111)),
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
            if (weight) typeface = Typeface.create("sans-serif", Typeface.BOLD)
        }

    fun pill(ctx: Context, text: String, good: Boolean? = null): TextView {
        val colors = when (good) {
            true -> softGreen to green
            false -> softAmber to amber
            else -> softBlue to blue
        }
        return label(ctx, text, 12f, colors.second, true).apply {
            gravity = Gravity.CENTER
            minHeight = dp(ctx, 30)
            background = bg(colors.first, 50, ctx)
            setPadding(dp(ctx, 12), dp(ctx, 5), dp(ctx, 12), dp(ctx, 5))
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
        background = bg(white, 24, ctx, line)
        setPadding(dp(ctx, 18), dp(ctx, 17), dp(ctx, 18), dp(ctx, 17))
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

    fun progressRing(ctx: Context, value: Int, maximum: Int): View = object : View(ctx) {
        private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(135, 255, 255, 255)
            style = Paint.Style.STROKE
            strokeWidth = dp(ctx, 10).toFloat()
            strokeCap = Paint.Cap.ROUND
        }
        private val progress = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = green
            style = Paint.Style.STROKE
            strokeWidth = dp(ctx, 10).toFloat()
            strokeCap = Paint.Cap.ROUND
        }
        private val number = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = navy
            textSize = ctx.resources.displayMetrics.scaledDensity * 27f
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            textAlign = Paint.Align.CENTER
        }
        private val caption = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = blueDeep
            textSize = ctx.resources.displayMetrics.scaledDensity * 10f
            textAlign = Paint.Align.CENTER
        }
        init { contentDescription = "已保留 $value 条挪车记录，上限 $maximum 条" }
        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val radius = min(width, height).toFloat() / 2f - dp(ctx, 10)
            val cx = width / 2f
            val cy = height / 2f
            val rect = RectF(cx - radius, cy - radius, cx + radius, cy + radius)
            canvas.drawArc(rect, -90f, 360f, false, track)
            val sweep = 360f * (value.toFloat() / maximum.coerceAtLeast(1)).coerceIn(0f, 1f)
            if (sweep > 0f) canvas.drawArc(rect, -90f, sweep, false, progress)
            canvas.drawText(value.toString(), cx, cy + dp(ctx, 1), number)
            canvas.drawText("条记录", cx, cy + dp(ctx, 19), caption)
        }
    }

    fun centerEmpty(ctx: Context, heading: String, description: String): LinearLayout =
        vertical(ctx).apply {
            setPadding(dp(ctx, 22), dp(ctx, 34), dp(ctx, 22), dp(ctx, 34))
            gravity = Gravity.CENTER
            addView(label(ctx, "✦", 32f, green, true).apply { gravity = Gravity.CENTER })
            addView(label(ctx, heading, 18f, navy, true).apply {
                gravity = Gravity.CENTER
                setPadding(0, dp(ctx, 14), 0, dp(ctx, 5))
            })
            addView(label(ctx, description, 13f, muted).apply { gravity = Gravity.CENTER })
        }
}
