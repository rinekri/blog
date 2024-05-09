+++

title = "Investigating an Android bug: The process"

[taxonomies]
tags = ["android", "bug", "guide", "experience"]

+++

Detective story of uncovering the reason behind a strange dark mode bug, with a helpful summary for anyone

<!-- more -->

In the working process of any project you encounter not trivial bugs and problems, the reasons for which you must find. Sometimes you can find the reason quickly, but other times you need to try hard. I decided to write about how I investigated one of these bugs to illustrate how to find solutions to such tasks.
# Backstory
Today I'm working on a mobile project which main features are chats and calls. I recently implemented a **dark theme feature**, which is _toggled off by default_.

When we enabled this feature for all user we received a bug report where our client said that they faced with **a strange issue**. A crucial part of this problem was that the app screens had different themes: one screen was light, while another was dark!

I agreed that it was really strange and began researching why it happened. And here is starting **the long story**... But before delving into it, I'd like to share some small _details about the technical implementation_.
## Technical implementation
I open you nothing new, but it can be meaningful to see the whole picture. Note that code was simplified.
### Application class
Inside this class, in the `onCreate` method, we synchronize a theme. This requires applying the app theme if it differs from the system theme (which is critical for Android versions below API 31) and enabling or disabling the theme switcher according to the feature toggle.
```Kotlin
class MyApplication : Application {  
  
    fun onCreate() {  
        if (themeRepository.isThemeSwitchingEnabled()) {  
            val currentTheme: Optional<Theme> = themeRepository.getCurrentThemeSync()  
            currentTheme.ifPresent { theme ->  
                themeRepository.setAndroidTheme(this, theme)  
            }  
        } else {  
            themeRepository.disableAndroidTheming()  
        }  
    }  
}
```
### ThemeRepository
In the real app all code is placed inside an Repository and Interactor, but for simplification there is only functions to toggle theme:
```Kotlin
fun ThemeRepository {
    fun setAndroidTheme(context: Context, theme: Theme) {  
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {  
            val uiMode = when (theme) {  
                Theme.Light -> UiModeManager.MODE_NIGHT_NO  
                Theme.Night -> UiModeManager.MODE_NIGHT_YES  
                Theme.System -> UiModeManager.MODE_NIGHT_AUTO  
            }  
            context.uiModeManager().setApplicationNightMode(uiMode)  
        } else {  
            val uiMode = when (theme) {  
                Theme.Light -> AppCompatDelegate.MODE_NIGHT_NO  
                Theme.Night -> AppCompatDelegate.MODE_NIGHT_YES  
                Theme.System -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM  
            }  
            AppCompatDelegate.setDefaultNightMode(uiMode)  
        }  
    }  
  
    fun disableAndroidTheming() {  
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {  
            uiModeManager()
	            .setApplicationNightMode(UiModeManager.MODE_NIGHT_NO) 
        } else {  
	        AppCompatDelegate
		        .setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO)  
        }  
    }  
}
```
### Settings screen
It is a screen where we can change the theme, where you can choose Night, Light or System themes:
```Kotlin
class SettingsScreen : Fragment {
	fun onSelectTheme(themeIndex: Int) {  
	    val themeRepository.getThemes()  
		val newTheme = themes[newThemeIndex]  
		themePrefs.storeCurrentThemeId(newTheme.id)
        themeRepository.setAndroidTheme(context, newTheme)  
    }
}
```
# First Act: Nothing reproduce
The client described all the reproduction steps, attached screenshots, and logs. The logs contain detailed information, including opened screens, executed Activity and Fragment Lifecycle methods, and more.

Firstly I tried to reproduce the problem: on different devices and emulators with different OS versions, but I found nothing - everything **worked as expected**! 

I additionally asked QA to check, but everything worked on their devices as well. Usually, in these situations, such bugs are simply _sent to the backlog_, because they shouldn't reproduce quite often. But I had a new hypothesis, that bug is connected with toggle: like it updates later, and app applies Light theme. And I decided to check this suppose. I added new logs with `Theme` tag to see all theme setting process from start to end.  

After it we build a new app version, sent it to the client and asked to send updated logs, but I wasn't sure that it will help.  

I additionally asked QA to check, but everything worked on their devices as well. Usually, in these situations, such bugs are simply _sent to the backlog_, because they shouldn't reproduce quite often. But I had a new suspicion that the bug is connected with the toggle: perhaps it updates later, and the app applies the Light theme. I decided to check this suspicion. I added new logs with the `Theme` tag to track the entire theme setting process from start to end.

Afterward, we built a new version, sent it to the client, and requested updated logs. However, I wasn't sure if it would help.
## Logs example
```txt
Theme | App: [MyApplication.switchThemeToLastSync]
Theme | Domain | ThemeInteractor.a():36: [switchThemeToLastSync, system ui mode MODE_NIGHT_NO]
Theme | Repository | ThemeRepository.c():28: [isThemeSwitchingEnabled, isEnabled = true]
Theme | Repository | com.google.firebase.installations.b.call():473: [getCurrentTheme, theme = Light, theme switching enabled]
Theme | View | BaseActivity.onCreate():79: [MainActivity.onCreate uiMode(), = UI_MODE_NIGHT_NO]
Theme | View | BaseFragment.onAttach():46: [MainFragment.onAttach uiMode(), = UI_MODE_NIGHT_NO]
Common | DataSource.FirebaseRemoteConfig: [feature_enable_theme_switching ] = true
Theme | View | BaseFragment.onViewCreated():49: [MainFragment.onViewCreated view context uiMode(), = UI_MODE_NIGHT_NO]
Theme | View | BaseActivity.onCreate():79: [SettingsActivity.onCreate uiMode(), = UI_MODE_NIGHT_NO]
Theme | View | BaseActivity.onCreate():79: [MainActivity.onCreate uiMode(), = UI_MODE_NIGHT_NO]
Theme | View | BaseFragment.onAttach():46: [MainFragment.onAttach uiMode(), = UI_MODE_NIGHT_NO]
Theme | View | BaseFragment.onViewCreated():49: [MainFragment.onViewCreated view context uiMode(), = UI_MODE_NIGHT_NO]
Theme | View | BaseActivity.onCreate():79: [SettingsActivity.onCreate uiMode(), = UI_MODE_NIGHT_NO]
```
# Second act: Extended logs
The client sent us new extended logs with `Theme` tag, which I closely investigated, however  everything worked as expected again!

I started to think why else the theme can be broken, and assume that it might be related to the `Don't keep activities` developer option. Yes, this variant is rare, but because we couldn't reproduce this bug at all it could be a true. Moreover, the bug report from the client was filled by their QA, which uses this option very often.

I started to check this new hypothesis on my test device, and I found that in this case **we really get this problem**! But reproduce _steps are different_, but visually it looks the same, I fought.

Then I suggested asking the client about this option and additionally thought of adding a new log about it, because it could be useful to investigate other bugs. I started to wait for an answer from our client, hoping that I was right. 

The small backstory about  `Don't keep activities`.
## Why it reproduces with  `Don’t keep activities`
When we use the `UiModeManager().setApplicationNightMode()` function, the system applies a new Context for all activities in a back stack. However, with the `Don’t keep activities` option enabled, all activities are destroyed immediately, and the system can't apply a new Context for them. Consequently, when we return to previous screens, they restore with the old theme.
## How to print info about `Don’t keep activities` 
It can be googled easy, but maybe it can be useful for someone.
```Kotlin
 fun isDontKeepActivitiesEnabled(context: Context): Boolean {  
    val state = Settings.Global.getInt(  
        context.contentResolver,  
        Settings.Global.ALWAYS_FINISH_ACTIVITIES,  
        0  
    )  
    return state != 0  
}
```
# Third act: Don’t keep activities
We received a new answer from the client, stating that they don't use `Don’t keep activities`, and even when it is enabled, the bug can be reproduced. It seemed like they didn't understand us correctly, but thankfully, we got the confirmation we needed anyway. However, the situation didn't become any clearer, and all my _ideas were left_.

But I didn't finish trying, and decided to localize the problem. I asked my colleagues if anyone had the same device with the same OS version where the client reproduced the bug. it was a `Pixel 7, Android 14`. Miraculously, such a person was found.

And this person reproduced the bug in exactly the same way as the client did! Nice! And I got even a video and logs from his device.

After that, I created the same emulator and tried to repeat all steps from the video, but nothing happened - **my app worked as usual**. And what to do next? I couldn't reproduce the bug, I didn't have a device to debug it, logs didn't help, and my previous ideas were wrong...
# Fourth act: Minimal example
It looks like hope is over, but what to do next? I diced to use my last try - to make a minimal example for reproduce.

I quickly created a pair of activities: a [main screen](https://raw.githubusercontent.com/rinekri/DarkModeBugSample/main/screens/main-screen.png) and a [settings screen](https://raw.githubusercontent.com/rinekri/DarkModeBugSample/main/screens/settings-screen.png). On the settings screen, there was an ability to choose the app theme. This example can be found on [GitHub](https://github.com/rinekri/DarkModeBugSample).

Next, I tried to reproduce the bug again step by step, but on this minimal example on an emulator with Android 14. However, it turned out that on this example everything **worked correctly too**! I felt empty and didn't understand why it worked... I started comparing the app and the sample side by side. And suddenly, I noticed that the app was restarted when the system theme was changed! _It was a giant clue_, which helped me to find the reason for the bug, but I will tell it a bit later.
# Fifth act: Restarting the application
It isn't easy to analyse system logs, so I tried to clear out extra logs and only kept those printed right after theme switching from System settings. I began to investigate the remaining system logs, focusing on places where the process was killed, and found one strange message:
```
2024-04-18 15:40:52.427 526-545 ActivityManager system_server I Killing 11810:com.rinekri.myapp/u0a193 (adj 700): resetConfig
```

But what does `resetConfig` mean, and what should I do with it?
To figure out it I started to google description of `adj 700`. Detailed description was found in [ProcessList.java](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-7.1.2_r38/services/core/java/com/android/server/am/ProcessList.java#75) class:
```
	// This is the process of the previous application that the user was in.|
	// This process is kept above other things, because it is very common to|
	// switch back to the previous app. This is important both for recent|
	// task switch (toggling between the two top recent apps) as well as normal|
	// UI flow such as clicking on a URI in the e-mail app to view in the browser,|
	// and then pressing back to return to e-mail.|
	static final int PREVIOUS_APP_ADJ = 700;|
```

Okay, it's interesting, but I didn't understand why it happened; I just got information about when it happened. Then I hurried to search for _kill process "resetConfig"_ on the Android Code Search site. I quickly found what I searched for in the [ActivityRecord.java](https://cs.android.com/android/platform/superproject/+/master:frameworks/base/services/core/java/com/android/server/wm/ActivityRecord.java;l=9704) class. The logic to kill the process with the _restartConfig_ reason was in the `restartProcessIfVisible` function.

The second step was to figure out what this code does and see where `restartProcessIfVisible` is executed. This function is executed in the same class in the [onConfigurationChanged](https://cs.android.com/android/platform/superproject/+/master:frameworks/base/services/core/java/com/android/server/wm/ActivityRecord.java;l=9052) method, where you can find this comment:
```
// For background activity that uses size compatibility mode, if the size or density of
// the display is changed, then reset the override configuration and kill the activity's
// process if its process state is not important to user.
```

But I still didn't understand how it is related to my case because we didn't use `compatibility mode`, and the screen size didn't change, I just changed the system theme! And what does `compatibility mode` even mean? I realised that I should figure out how we can enable this mode to clarify the situation. In the end, I found an article with all available variants related to this mode, and the first reason mentioned was `resizeableActivity=true`. It turned out that our app uses this property, but it set to `false`. Of course I didn't set this property for my sample, and after that I finally reproduced this elusive bug! 

Even if this bug was reproduced in my sample, in the app, when the process was killed, the theme was restored correctly, except for the Splash screen. Here, I realised that I synchronise the app theme on Application start. I commented out this part of the code, and everything came together. At this moment, I was 100% sure that it's an Android bug because neither I nor the user expected that the app would be partially themed when the system changed. I decided to create an issue for Google on Google Issue Tracker.
# Sixth act: Bugreport for Google
The problem was found, and the secret was revealed, but I was haunted by one strange thing - why the user's app was broken without any manipulations with the code, while the app on my emulator worked correctly (except for the white Splash screen and restart). I wanted to understand this part too. Then I collected information about the [Build Numbers](https://source.android.com/docs/setup/reference/build-numbers) of emulators and phones where I checked the bug, and I formed this list:
* UE1A.230829.036.A2 - Android 14
* AP1A.240405.002 - Android 14, Pixel 7 (2024-04-05)
* UP1A.231105.001.B2 - Pixel 5 Android 14 (2023-11-05)
* AP21.240305.005 - Pixel 6, Android 14

Additionally, I decided to try to reproduce the bug on Android 15, and as it turned out, it reproduces exactly the same as on the user's device! This is an additional confirmation that something isn't right!

Because of that, I collected all information, recorded a video, and created a bug report in [Google Issue Tracker](https://issuetracker.google.com/issues/335782501). I understand that it can be a rare case because not a lot of apps use `resizeableActivity=false`, but this behavior looks not user-friendly.

I would appreciate it if someone would like this bug, maybe Google will fix it faster! Although it's still possible that I found the wrong place and reason, and it turns out that it isn't a bug at all! But that's even better!
# Summary
Despite spending nearly a week on investigation, I was happy that I found the reason and made a point in this story. Was it worth it? I think yes. Anyway, because of it, I wrote this article!

**Let's summarize how to research strange bugs:**
1. Add and extend logs, as they are useful, but also check system logs if possible.
2. Try to find exactly the same device (model and OS version) where the bug was found.
3. Create a minimal sample to reproduce the bug.
4. Pay attention to even small differences in behavior between the app and the minimal example.
5. Continue searching for information, starting from small clues.
6. Consider even unlikely reasons; even if they are not confirmed, they may lead you in the right direction.

Thanks for reading, and offer your options!
# Used resources
* https://cs.android.com/
* https://source.android.com/
* ChatGPT to correct spelling mistakes 