// fetch quotes a URL that holds a user name or password, and a header value that
// holds a line break, in the error it throws. That error is stored with the
// message, where anyone who reads messages sees it.

import { validateHeaderValue } from 'node:http';

/** Throws without quoting what fetch would refuse. Not at deploy: one destination that can never send must not keep its channel from starting. */
export function refuseQuotedCredentials(url: URL, headers: Readonly<Record<string, string>>): void {
  if (url.username !== '' || url.password !== '') {
    throw new Error('The URL holds a user name or password, which cannot be sent that way. Take them out of the URL and use an Authorization header or the destination\'s authentication settings.');
  }
  // fetch trims a value first. The error of this check names the header and not its value.
  for (const [name, value] of Object.entries(headers)) validateHeaderValue(name, value.trim());
}
