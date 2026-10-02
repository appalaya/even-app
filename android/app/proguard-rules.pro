# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:

# WorkManager (which expo-background-task runs on) makes these by reflection through their no-arg constructors, and
# R8's full mode strips both: Room 2.5.0's consumer rule keeps the generated WorkDatabase_Impl class but not its
# constructor, so WorkManager's initializer threw before any JS ran and the release build crashed at launch; and
# without OverwritingInputMerger's constructor every worker failed ("Could not create Input Merger").
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keep class * extends androidx.work.InputMerger { <init>(); }
