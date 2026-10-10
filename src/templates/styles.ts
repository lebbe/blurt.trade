import { createHash } from 'node:crypto'
import { mapHeight, mapWidth } from '../geo.ts'
import { avatarCss } from './avatar.ts'

// The one stylesheet every HTML page links to. It is a served file, not an inline
// <style>, so the Content-Security-Policy can be style-src 'self' with no 'unsafe-inline'
// (see src/middleware/security-headers.ts). For the same reason the templates never use
// style="..." attributes: anything per-element goes in SVG attributes or a class here.
export const stylesheet = `
:root {
  color-scheme: light;
  font-family: Georgia, serif;
  background: #f4f0e8;
  color: #201d1a;
}
body {
  max-width: 42rem;
  margin: 0 auto;
  padding: 2rem 1rem;
}
h1 {
  margin: 0 0 0.25rem;
  font-size: 2.5rem;
}
.tagline {
  margin: 0 0 2rem;
  color: #6d6258;
}
form,
.blurt {
  border: 1px solid #cfc5b8;
  background: #fffdf8;
  padding: 1rem;
}
form {
  display: grid;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}
.validation-error {
  margin: 0;
  color: #a32020;
  font-weight: bold;
}
label {
  display: grid;
  gap: 0.3rem;
  font-size: 0.9rem;
}
input,
textarea,
button {
  font: inherit;
  padding: 0.65rem;
  border: 1px solid #aaa095;
}
textarea {
  min-height: 5rem;
  resize: vertical;
}
button {
  background: #201d1a;
  color: #fffdf8;
  cursor: pointer;
}
.button-link {
  display: inline-block;
  border: 1px solid #aaa095;
  background: #201d1a;
  color: #fffdf8;
  text-decoration: none;
  padding: 0.45rem 0.8rem;
}
.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}
.section-title h2 {
  margin: 0;
}
.profile-data {
  border: 1px solid #cfc5b8;
  background: #fffdf8;
  margin: 0 0 1rem;
  padding: 1rem;
}
.profile-data dt {
  font-weight: bold;
  margin-top: 0.7rem;
}
.profile-data dt:first-child {
  margin-top: 0;
}
.profile-data dd {
  margin: 0.2rem 0 0;
}
.blurt {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  margin-top: 0.75rem;
}
.blurt:nth-of-type(even) {
  flex-direction: row-reverse;
}
.blurt-body {
  flex: 1;
  min-width: 0;
}
.profile-header {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.avatar-form {
  grid-template-columns: auto 1fr;
  align-items: start;
  gap: 1rem;
}
.avatar-preview p {
  margin: 0.25rem 0 0;
  font-size: 0.85rem;
}
.avatar-fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
  gap: 0.75rem;
}
.avatar-buttons {
  grid-column: 1 / -1;
  display: flex;
  gap: 0.75rem;
}
.color-field input {
  width: 100%;
  height: 2.6rem;
  padding: 0.2rem;
}
select {
  font: inherit;
  padding: 0.6rem;
  border: 1px solid #aaa095;
  background: #fffdf8;
}
${avatarCss}
.blurt-meta {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}
time {
  color: #6d6258;
  font-size: 0.85rem;
}
.empty {
  color: #6d6258;
}
.replies {
  margin-left: 1rem;
  padding-left: 0.75rem;
  border-left: 3px solid #cfc5b8;
}
.replies .blurt {
  padding: 0.6rem;
}
.blurt-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 1rem;
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
}
.blurt-action summary {
  cursor: pointer;
  color: #6d6258;
}
.inline-form {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 0.5rem;
  margin: 0.5rem 0 0;
  padding: 0.5rem;
}
.inline-form button,
.inline-form input {
  padding: 0.3rem 0.6rem;
}
.blurt.deleted {
  border-style: dashed;
}
.report ul {
  margin: 0.5rem 0;
}
.report-buttons {
  display: flex;
  gap: 0.75rem;
}
.report-buttons .inline-form {
  border: 0;
  background: none;
  padding: 0;
}
section h2 {
  margin-top: 2rem;
}
.tabs {
  display: flex;
  gap: 1rem;
  margin: 1.5rem 0 0;
}
.tabs a[aria-current='page'] {
  font-weight: bold;
  color: inherit;
  text-decoration: none;
}
.follow-counts {
  margin: 0 0 0.75rem;
  color: #6d6258;
}
.follow-form {
  display: inline-block;
  border: 0;
  background: none;
  padding: 0;
}
.discovery {
  margin: 1.5rem 0;
  padding: 0 1rem 1rem;
  border: 1px dashed #aaa095;
}
.discovery h2 {
  margin: 1rem 0 0.25rem;
  font-size: 1.1rem;
}
.discovery-description {
  margin: 0;
  color: #6d6258;
  font-size: 0.9rem;
}
.map {
  overflow-x: auto;
  margin-bottom: 1rem;
}
.map-form {
  padding: 0;
}
.map-inner {
  position: relative;
  width: ${mapWidth}px;
  height: ${mapHeight}px;
}
.map-inner input {
  display: block;
  padding: 0;
  border: 0;
  cursor: crosshair;
}
/* An SVG laid over the whole map; its circle's cx/cy place the marker. */
.map-marker {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}
.next-page {
  margin: 1.5rem 0 0;
  text-align: center;
}
.hint {
  margin: 0;
  font-size: 0.85rem;
  color: #6d6258;
}
body > footer {
  margin-top: 3rem;
  padding-top: 1rem;
  border-top: 1px solid #cfc5b8;
  font-size: 0.85rem;
  color: #6d6258;
  text-align: center;
}
body > footer a {
  color: inherit;
}
`

// The URL carries a hash of the content, so the file can be cached for good and a
// deploy that changes the CSS is picked up at once.
const stylesheetHash = createHash('sha256').update(stylesheet).digest('hex').slice(0, 12)
export const stylesheetUrl = `/static/style.css?v=${stylesheetHash}`
