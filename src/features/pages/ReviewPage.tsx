import { Field, SectionCard } from "../../components/StudioUi";
import type { IpfsHeadResult, IpfsSnippetResult } from "../../ipfs/client";
import {
  clampProgressPercent,
  formatBytes,
  type ReviewFile,
  type ReviewWorkspacePage,
} from "../studio-model";

type ReviewPageProps = {
  reviewWorkspacePage: ReviewWorkspacePage;
  reviewCid: string;
  reviewLoading: boolean;
  reviewProgressPercent: number;
  reviewProgressMessage: string;
  reviewProgressIpcId: number | null;
  reviewFiles: ReviewFile[];
  reviewCodeFileCount: number;
  filteredReviewFiles: ReviewFile[];
  reviewQuery: string;
  selectedReviewPath: string;
  selectedReviewHead: IpfsHeadResult | null;
  selectedReviewSnippet: IpfsSnippetResult | null;
  renderedSnippet: string;
  onReviewWorkspacePageChange: (page: ReviewWorkspacePage) => void;
  onReviewCidChange: (value: string) => void;
  onLoadReviewBundle: () => void;
  onReviewQueryChange: (value: string) => void;
  onReviewPathChange: (value: string) => void;
  onOpenReviewFile: (path: string) => void;
  onOpenTypedReviewPath: () => void;
};

export function ReviewPage(props: ReviewPageProps) {
  return (
    <SectionCard
      title="Code Review Workspace"
      subtitle="Split between bundle summary and deep file explorer"
      right={
        <div className="studio-inline-controls">
          <button
            className={`btn ${props.reviewWorkspacePage === "summary" ? "btn-primary" : ""}`}
            onClick={() => props.onReviewWorkspacePageChange("summary")}
          >
            Summary
          </button>
          <button
            className={`btn ${props.reviewWorkspacePage === "explorer" ? "btn-primary" : ""}`}
            onClick={() => props.onReviewWorkspacePageChange("explorer")}
          >
            Explorer
          </button>
        </div>
      }
    >
      <div className="studio-review-controls">
        <Field label="Bundle CID">
          <input
            value={props.reviewCid}
            onChange={(e) => props.onReviewCidChange(e.target.value)}
            placeholder="bafy..."
          />
        </Field>
        <button className="btn btn-primary" onClick={props.onLoadReviewBundle} disabled={props.reviewLoading}>
          Load Manifest Files
        </button>
      </div>
      {props.reviewLoading ? (
        <div className="studio-progress" role="status" aria-live="polite">
          <div className="studio-progress-head">
            <span>{props.reviewProgressMessage || "Loading review workspace..."}</span>
            <span>{clampProgressPercent(props.reviewProgressPercent)}%</span>
          </div>
          <div className="studio-progress-track">
            <div
              className="studio-progress-bar"
              style={{ width: `${clampProgressPercent(props.reviewProgressPercent)}%` }}
            />
          </div>
          {props.reviewProgressIpcId !== null ? (
            <div className="studio-progress-meta">IPC #{props.reviewProgressIpcId}</div>
          ) : null}
        </div>
      ) : null}

      {props.reviewWorkspacePage === "summary" ? (
        <>
          <section className="studio-metrics">
            <article className="studio-metric-card">
              <span>Manifest Files</span>
              <strong>{props.reviewFiles.length}</strong>
            </article>
            <article className="studio-metric-card">
              <span>Code Files</span>
              <strong>{props.reviewCodeFileCount}</strong>
            </article>
            <article className="studio-metric-card">
              <span>Data Files</span>
              <strong>{Math.max(0, props.reviewFiles.length - props.reviewCodeFileCount)}</strong>
            </article>
            <article className="studio-metric-card">
              <span>Bidi Flags</span>
              <strong>{props.selectedReviewSnippet?.hasBidiControls ? "Detected" : "None"}</strong>
            </article>
          </section>

          <section className="studio-grid-two">
            <SectionCard title="Selected File Snapshot" subtitle="High-level file metadata and current snippet">
              <div className="studio-review-meta">
                <div className="studio-review-meta-row">
                  <span className="studio-review-meta-key">Path</span>
                  <span className="studio-review-meta-value">{props.selectedReviewPath || "-"}</span>
                </div>
                <div className="studio-review-meta-row">
                  <span className="studio-review-meta-key">Range</span>
                  <span className="studio-review-meta-value">
                    {props.selectedReviewSnippet
                      ? `${props.selectedReviewSnippet.lineStart}-${props.selectedReviewSnippet.lineEnd}`
                      : "-"}
                  </span>
                </div>
                <div className="studio-review-meta-row">
                  <span className="studio-review-meta-key">Size</span>
                  <span className="studio-review-meta-value">
                    {props.selectedReviewHead ? formatBytes(props.selectedReviewHead.size) : "-"}
                  </span>
                </div>
                <div className="studio-review-meta-row">
                  <span className="studio-review-meta-key">Content-Type</span>
                  <span className="studio-review-meta-value">{props.selectedReviewHead?.contentType ?? "-"}</span>
                </div>
              </div>
              <pre className="studio-snippet">{props.renderedSnippet}</pre>
            </SectionCard>

            <SectionCard title="File Manifest" subtitle="Browse and open files directly from manifest listing">
              <div className="studio-review-files-head">
                <strong>
                  Files ({props.filteredReviewFiles.length}/{props.reviewFiles.length})
                </strong>
                <input
                  value={props.reviewQuery}
                  onChange={(e) => props.onReviewQueryChange(e.target.value)}
                  placeholder="Filter files..."
                />
              </div>
              <div className="studio-review-file-list">
                {props.filteredReviewFiles.map((file) => (
                  <button
                    key={`summary-${file.path}`}
                    className={`studio-review-file-btn ${file.path === props.selectedReviewPath ? "active" : ""}`}
                    onClick={() => props.onOpenReviewFile(file.path)}
                    disabled={props.reviewLoading}
                  >
                    <span className={file.isCode ? "studio-badge-code" : "studio-badge-data"}>
                      {file.isCode ? "code" : "data"}
                    </span>
                    <span className="studio-review-file-path">{file.path}</span>
                    <span className="studio-review-file-size">{formatBytes(file.bytes)}</span>
                  </button>
                ))}
                {props.filteredReviewFiles.length === 0 ? (
                  <div className="studio-review-empty">No files match the current filter.</div>
                ) : null}
              </div>
            </SectionCard>
          </section>
        </>
      ) : (
        <>
          <div className="studio-review-open-controls">
            <Field label="Open File Path">
              <input
                value={props.selectedReviewPath}
                onChange={(e) => props.onReviewPathChange(e.target.value)}
                placeholder="src/App.tsx"
              />
            </Field>
            <button
              className="btn btn-primary studio-review-open-btn"
              onClick={props.onOpenTypedReviewPath}
              disabled={props.reviewLoading}
            >
              Open Path
            </button>
          </div>

          <div className="studio-review-layout">
            <aside className="studio-review-files">
              <div className="studio-review-files-head">
                <strong>
                  Files ({props.filteredReviewFiles.length}/{props.reviewFiles.length})
                </strong>
                <input
                  value={props.reviewQuery}
                  onChange={(e) => props.onReviewQueryChange(e.target.value)}
                  placeholder="Filter files..."
                />
              </div>
              <div className="studio-review-file-list">
                {props.filteredReviewFiles.map((file) => (
                  <button
                    key={file.path}
                    className={`studio-review-file-btn ${file.path === props.selectedReviewPath ? "active" : ""}`}
                    onClick={() => props.onOpenReviewFile(file.path)}
                    disabled={props.reviewLoading}
                  >
                    <span className={file.isCode ? "studio-badge-code" : "studio-badge-data"}>
                      {file.isCode ? "code" : "data"}
                    </span>
                    <span className="studio-review-file-path">{file.path}</span>
                    <span className="studio-review-file-size">{formatBytes(file.bytes)}</span>
                  </button>
                ))}
                {props.filteredReviewFiles.length === 0 ? (
                  <div className="studio-review-empty">No files match the current filter.</div>
                ) : null}
              </div>
            </aside>

            <section className="studio-review-preview">
              <div className="studio-review-meta">
                <div className="studio-review-meta-row">
                  <span className="studio-review-meta-key">Path</span>
                  <span className="studio-review-meta-value">{props.selectedReviewPath || "-"}</span>
                </div>
                <div className="studio-review-meta-row">
                  <span className="studio-review-meta-key">Range</span>
                  <span className="studio-review-meta-value">
                    {props.selectedReviewSnippet
                      ? `${props.selectedReviewSnippet.lineStart}-${props.selectedReviewSnippet.lineEnd}`
                      : "-"}
                  </span>
                </div>
                <div className="studio-review-meta-row">
                  <span className="studio-review-meta-key">Size</span>
                  <span className="studio-review-meta-value">
                    {props.selectedReviewHead ? formatBytes(props.selectedReviewHead.size) : "-"}
                  </span>
                </div>
                <div className="studio-review-meta-row">
                  <span className="studio-review-meta-key">Content-Type</span>
                  <span className="studio-review-meta-value">{props.selectedReviewHead?.contentType ?? "-"}</span>
                </div>
              </div>
              <pre className="studio-snippet studio-review-snippet">{props.renderedSnippet}</pre>
            </section>
          </div>
        </>
      )}
    </SectionCard>
  );
}
