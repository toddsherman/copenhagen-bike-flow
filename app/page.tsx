import FlowLoader from "./flow-loader";

export default function Page() {
  return (
    <>
      <a className="tsh-back" href="https://www.todd.sh">
        <span aria-hidden="true">←</span>
        todd.sh
      </a>
      <FlowLoader />
    </>
  );
}
