export const TELEGRAM_TOKEN = "8764698656:AAF7Iwv97ECwtrFhrafDIdaIwUArtb4Qf_w";
export const TELEGRAM_CHAT_ID = "-1003750590453";

/**
 * Uploads an image to Telegram using the sendPhoto method.
 * @param file The image file to upload.
 * @returns The file_id of the uploaded image.
 */
export async function uploadImageToTelegram(file: File): Promise<{fileId: string, messageId: number}> {
  const formData = new FormData();
  formData.append("chat_id", TELEGRAM_CHAT_ID);
  formData.append("photo", file);

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.description || "Failed to upload image to Telegram");
  }

  const data = await response.json();
  
  // Telegram returns an array of photo sizes. The last one is usually the highest resolution.
  const photos = data.result.photo;
  const largestPhoto = photos[photos.length - 1];
  
  return { 
    fileId: largestPhoto.file_id, 
    messageId: data.result.message_id 
  };
}

/**
 * Gets the direct download URL for a file_id from Telegram.
 * Note: Telegram file URLs are temporary and valid for about 1 hour.
 * @param fileId The file_id from Telegram.
 * @returns The direct URL to the image.
 */
export async function getImageUrlFromTelegram(fileId: string): Promise<string> {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
  
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.description || "Failed to get file info from Telegram");
  }

  const data = await response.json();
  const filePath = data.result.file_path;
  
  return `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
}

/**
 * Deletes a message containing an image from the Telegram channel.
 * @param messageId The message ID to delete.
 */
export async function deleteImageFromTelegram(messageId: number): Promise<void> {
  const body = JSON.stringify({
    chat_id: TELEGRAM_CHAT_ID,
    message_id: messageId,
  });

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/deleteMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: body,
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error("Failed to delete message from Telegram:", errorData);
  }
}
