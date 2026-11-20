import { Fragment } from "react";

/**
 * Email text as written, with one bit of formatting: a line wrapped in underscores
 * (`_like this_`) shows in italics, the way a mail client shows emphasis. Used for
 * the simulation disclaimer at the foot of each scenario's first email.
 */
export function EmailBody({ body, className }: { body: string; className?: string }) {
  const lines = body.split("\n");
  return (
    <div className={className}>
      {lines.map((line, i) => {
        const m = /^_(\S(?:.*\S)?)_$/.exec(line.trim());
        return (
          <Fragment key={i}>
            {m ? <em>{m[1]}</em> : line}
            {i < lines.length - 1 && "\n"}
          </Fragment>
        );
      })}
    </div>
  );
}
