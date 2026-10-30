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
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** Shared native surfaces for the owner console and call screens. */
internal object OwnerUi {
    val navy = Color.rgb(24, 38, 48)
    val blue = Color.rgb(31, 102, 134)
    val blueDeep = Color.rgb(35, 75, 94)
    val canvas = Color.rgb(247, 248, 250)
    val muted = Color.rgb(119, 131, 144)
    val line = Color.rgb(233, 237, 241)
    val white = Color.WHITE

    val softBlue = Color.rgb(221, 243, 250)
    val green = Color.rgb(23, 110, 104)
    val success = Color.rgb(19, 133, 104)
    val softGreen = Color.rgb(232, 246, 220)
    val amber = Color.rgb(190, 135, 55)
    val softAmber = Color.rgb(255, 242, 184)
    val red = Color.rgb(217, 74, 74)
    val softRed = Color.rgb(251, 227, 220)
    val softPurple = Color.rgb(238, 234, 251)
    val warningSurface = Color.rgb(255, 249, 230)
    val inputLine = Color.rgb(220, 228, 234)

    fun dp(context: Context, value: Int): Int =
        (context.resources.displayMetrics.density * value + 0.5f).toInt()

    fun bg(color: Int, radiusDp: Int, ctx: Context, stroke: Int? = null): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(ctx, radiusDp).toFloat()
            if (stroke != null) setStroke(dp(ctx, 1), stroke)
        }

    fun gradient(context: Context): GradientDrawable = bg(softBlue, 20, context)

    fun pressable(context: Context, color: Int, radius: Int = 18, border: Int? = null): RippleDrawable =
        RippleDrawable(
            ColorStateList.valueOf(Color.argb(28, 23, 110, 104)),
            bg(color, radius, context, border),
            null
        )

    fun pressableGradient(context: Context, colors: IntArray, radius: Int = 18,
                          border: Int? = null): RippleDrawable =
        RippleDrawable(
            ColorStateList.valueOf(Color.argb(28, 31, 102, 134)),
            GradientDrawable(GradientDrawable.Orientation.TL_BR, colors).apply {
                cornerRadius = dp(context, radius).toFloat()
                if (border != null) setStroke(dp(context, 1), border)
            },
            null
        )

    fun flatCallButton(ctx: Context, title: String, foreground: Int, surface: Int,
                       radius: Int = 20): Button = Button(ctx).apply {
        text = title
        isAllCaps = false
        setTextColor(foreground)
        background = pressable(ctx, surface, radius)
        // Platform Button keeps its elevation animator after a custom background
        // is assigned; disable both the resting and pressed-state shadows.
        stateListAnimator = null
        elevation = 0f
        translationZ = 0f
        includeFontPadding = false
    }

    fun label(ctx: Context, text: String, size: Float = 14f, color: Int = navy,
              weight: Boolean = false): TextView =
        TextView(ctx).apply {
            this.text = text
            textSize = size
            setTextColor(color)
            includeFontPadding = false
            if (weight) typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        }

    fun headline(ctx: Context, text: String, size: Float, color: Int = navy): TextView =
        label(ctx, text, size, color).apply {
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
        }

    fun pill(ctx: Context, text: String, good: Boolean? = null): TextView {
        val colors = when (good) {
            true -> softGreen to success
            false -> softAmber to amber
            else -> Color.rgb(241, 243, 245) to muted
        }
        return headline(ctx, text, 13f, colors.second).apply {
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
        background = bg(white, 20, ctx, line)
        setPadding(dp(ctx, 18), dp(ctx, 18), dp(ctx, 18), dp(ctx, 18))
        elevation = 0f
    }

    fun icon(ctx: Context, res: Int, tint: Int = blue, sizeDp: Int = 22): ImageView =
        ImageView(ctx).apply {
            setImageResource(res)
            setColorFilter(tint)
            layoutParams = LinearLayout.LayoutParams(dp(ctx, sizeDp), dp(ctx, sizeDp))
            contentDescription = null
        }
    fun iconCircle(ctx:Context,res:Int,surface:Int,sizeDp:Int=42):LinearLayout =
        horizontal(ctx).apply {
            gravity=Gravity.CENTER
            background=bg(surface,sizeDp/2,ctx)
            addView(icon(ctx,res,navy,23),LinearLayout.LayoutParams(dp(ctx,23),dp(ctx,23)))
        }

    fun line(ctx: Context): View = View(ctx).apply {
        setBackgroundColor(line)
        layoutParams = LinearLayout.LayoutParams(-1, dp(ctx, 1))
    }

    fun centerEmpty(ctx: Context, heading: String, description: String): LinearLayout =
        vertical(ctx).apply {
            setPadding(dp(ctx, 22), dp(ctx, 24), dp(ctx, 22), dp(ctx, 24))
            gravity = Gravity.CENTER
            addView(icon(ctx,R.drawable.ic_nav_car,green,26).apply{
                background=bg(softGreen,14,ctx)
                setPadding(dp(ctx,10),dp(ctx,10),dp(ctx,10),dp(ctx,10))
            },LinearLayout.LayoutParams(dp(ctx,48),dp(ctx,48)))
            addView(headline(ctx, heading, 18f).apply {
                gravity = Gravity.CENTER
                setPadding(0, dp(ctx,13), 0, dp(ctx, 5))
            })
            addView(label(ctx, description, 13f, muted).apply { gravity = Gravity.CENTER })
        }
}
