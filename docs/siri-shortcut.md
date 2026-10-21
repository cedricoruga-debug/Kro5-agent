# "Hey Siri, KRO5": set up the Siri Shortcut

The Shortcut lets you ask KRO5 a question hands-free. It works with the phone locked or while you're in another app. Siri listens to you, sends what you said to KRO5, and reads the answer aloud.

Siri mode can only **read**: deploys, pull requests, issues and database numbers. If you ask it to add a task, queue a build brief or ask the team, it tells you what it would send and asks you to confirm in the KRO5 app, where you can say yes first.

It takes about 5 minutes on your iPhone.

## 1. Copy the Shortcut key

1. Open [kro5-agent → Settings → Environment Variables](https://vercel.com/cedric-s-va-hub/kro5-agent/settings/environment-variables) in Safari.
2. Find `KRO5_SHORTCUT_TOKEN` and tap the eye icon to reveal it.
3. Copy the value. Don't paste it anywhere except the Shortcut.

## 2. Build the Shortcut

1. Open the **Shortcuts** app and tap **+**.
2. Tap the name at the top and call it **KRO5**. This is what you say to Siri.
3. Tap **Add Action**, search for **Dictate Text** and add it.
   - Tap the arrow on the action. Set **Stop Listening** to **After Pause** and **Language** to English.
4. Add **Get Contents of URL**.
   - Tap **URL** and type `https://voice.kro5.app/api/ask`
   - Tap the arrow on the action to show more options.
   - **Method:** POST
   - **Headers:** tap **Add new header**. Key: `Authorization`. Value: `Bearer ` (with a space after it) and then paste the key.
   - **Request Body:** JSON. Tap **Add new field → Text**. Key: `text`. For the value, tap the variable bar above the keyboard and choose **Dictated Text**.
5. Add **Speak Text**. It uses **Contents of URL** automatically.
6. Tap **Done**.

## 3. Try it

Say **"Hey Siri, KRO5"**, wait for Siri to listen, then ask "Did the last deploy work?"

The first time, Siri may ask permission to send data to voice.kro5.app. Tap **Always Allow**.

## If something goes wrong

- **"KRO5 didn't recognise this Shortcut's key":** check that the header value is `Bearer`, a space, and then the key, with no extra spaces.
- **Siri says nothing:** run the Shortcut once from the Shortcuts app to see any error, and check the volume.
- **To change the key:** edit `KRO5_SHORTCUT_TOKEN` in Vercel (32+ random characters), redeploy, then update the Shortcut's header.
