/**
 * Uploads any file to Telegram using the appropriate method (sendPhoto, sendVideo, or sendDocument).
 * @param file The file to upload.
 * @param botToken The user's Telegram bot token.
 * @param chatId The user's Telegram chat/channel ID.
 * @param onProgress Callback for upload progress.
 * @returns The file_id and message_id of the uploaded file.
 */
export async function uploadFileToTelegram(
  file: File, 
  botToken: string, 
  chatId: string,
  onProgress?: (progress: number) => void
): Promise<{fileId: string, messageId: number}> {
  const cleanToken = botToken.trim();
  const cleanChatId = chatId.trim();
  
  const isImage = file.type.startsWith('image/') && !file.type.includes('svg');
  const isVideo = file.type.startsWith('video/');
  
  const formData = new FormData();
  formData.append("chat_id", cleanChatId);
  
  let endpoint = "sendDocument";
  let fileKey = "document";

  if (isImage) {
    endpoint = "sendPhoto";
    fileKey = "photo";
  } else if (isVideo) {
    endpoint = "sendVideo";
    fileKey = "video";
  }

  formData.append(fileKey, file);
  
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.telegram.org/bot${cleanToken}/${endpoint}`, true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const progress = Math.round((event.loaded / event.total) * 100);
        onProgress(progress);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          let fileId = '';
          
          if (endpoint === "sendPhoto") {
            const photos = data.result.photo;
            fileId = photos[photos.length - 1].file_id;
          } else if (endpoint === "sendVideo") {
            fileId = data.result.video.file_id;
          } else {
            // sendDocument, sendAudio, etc
            fileId = data.result.document?.file_id || 
                     data.result.audio?.file_id || 
                     data.result.voice?.file_id ||
                     data.result.video?.file_id ||
                     data.result.photo?.[0]?.file_id;
          }

          if (!fileId) {
            console.error("Telegram response missing file_id:", data);
            reject(new Error("Telegram response missing file_id"));
            return;
          }

          resolve({ 
            fileId, 
            messageId: data.result.message_id 
          });
        } catch (e) {
          reject(new Error("Failed to parse Telegram response"));
        }
      } else {
        let errorMsg = `HTTP Error ${xhr.status} Failed to upload file to Telegram`;
        try {
          const errorData = JSON.parse(xhr.responseText);
          if (errorData.description) errorMsg = errorData.description;
        } catch (e) {
          // Ignore parse error
        }
        reject(new Error(errorMsg));
      }
    };

    xhr.onerror = () => {
      reject(new Error("Network error during upload"));
    };

    xhr.send(formData);
  });
}

/**
 * Gets the direct download URL for a file_id from Telegram.
 * Note: Telegram file URLs are temporary and valid for about 1 hour.
 * @param fileId The file_id from Telegram.
 * @param botToken The user's Telegram bot token.
 * @returns The direct URL to the image.
 */
export async function getImageUrlFromTelegram(fileId: string, botToken: string): Promise<string> {
  const cleanToken = botToken.trim();
  const response = await fetch(`https://api.telegram.org/bot${cleanToken}/getFile?file_id=${fileId}`);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.description || `HTTP Error ${response.status} Failed to get file info from Telegram`);
  }

  const data = await response.json();
  const filePath = data.result.file_path;
  
  return `https://api.telegram.org/file/bot${cleanToken}/${filePath}`;
}

/**
 * Deletes a message containing an image from the Telegram channel.
 * @param messageId The message ID to delete.
 * @param botToken The user's Telegram bot token.
 * @param chatId The user's Telegram chat/channel ID.
 */
export async function deleteImageFromTelegram(messageId: number, botToken: string, chatId: string): Promise<void> {
  const cleanToken = botToken.trim();
  const cleanChatId = chatId.trim();
  
  const body = JSON.stringify({
    chat_id: cleanChatId,
    message_id: messageId,
  });

  const response = await fetch(`https://api.telegram.org/bot${cleanToken}/deleteMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: body,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error("Failed to delete message from Telegram:", errorData);
  }
}
