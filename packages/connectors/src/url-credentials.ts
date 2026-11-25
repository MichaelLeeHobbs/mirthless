// fetch refuses a URL that holds a user name or password and quotes it in its
// error, which is stored with the message where anyone who reads messages sees it.

export const URL_CREDENTIALS_REFUSED = 'The URL holds a user name or password, which cannot be sent that way. Take them out of the URL and set them as the destination\'s authentication.';

export function refuseUrlCredentials(url: URL): void {
  if (url.username !== '' || url.password !== '') throw new Error(URL_CREDENTIALS_REFUSED);
}
